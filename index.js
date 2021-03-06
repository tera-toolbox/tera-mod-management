const fs = require('fs');
const path = require('path');

const CoreModules = {
    "command": "https://raw.githubusercontent.com/tera-toolbox/command/master/module.json",
    "tera-game-state": "https://raw.githubusercontent.com/tera-toolbox/tera-game-state/master/module.json",
};

const readmeFileNames = ["readme.md", "readme.txt", "instructions.txt", "instructions.md"];

// Installed module management
function forcedirSync(dir) {
    const sep = path.sep;
    const initDir = path.isAbsolute(dir) ? sep : '';
    dir.split(sep).reduce((parentDir, childDir) => {
        const curDir = path.resolve(parentDir, childDir);
        try {
            fs.mkdirSync(curDir);
        } catch (_) {
            // Ignore
        }

        return curDir;
    }, initDir);
}

function installModule(rootFolder, installInfo, nameOverride = null) {
    const modName = nameOverride || installInfo.name;
    const modFolder = path.join(rootFolder, modName);
    forcedirSync(modFolder);
    fs.writeFileSync(path.join(modFolder, 'module.json'), JSON.stringify(installInfo, null, 4));
}

function uninstallModule(moduleInfo) {
    function rmdirSyncForce(dir_path) {
        if (!fs.existsSync(dir_path))
            return;

        fs.readdirSync(dir_path).forEach(entry => {
            const entry_path = path.join(dir_path, entry);
            if (fs.lstatSync(entry_path).isDirectory())
                rmdirSyncForce(entry_path);
            else
                fs.unlinkSync(entry_path);
        });
        fs.rmdirSync(dir_path);
    }

    if (fs.lstatSync(moduleInfo.path).isDirectory())
        rmdirSyncForce(moduleInfo.path);
    else
        fs.unlinkSync(moduleInfo.path);
}

function isCoreModule(moduleInfo) {
    return CoreModules.hasOwnProperty(moduleInfo.name);
}

function listModules(rootFolder) {
    let names = [];
    if (!fs.existsSync(rootFolder))
        return;

    for (let name of fs.readdirSync(rootFolder)) {
        if (name[0] === "." || name[0] === "_")
            continue;
        if (!name.endsWith(".js") && !fs.statSync(path.join(rootFolder, name)).isDirectory())
            continue;

        names.push(name);
    }

    return names;
}

function listModuleInfos(rootFolder) {
    return listModules(rootFolder).map(mod => {
        try {
            return loadModuleInfo(rootFolder, mod);
        } catch (_) {
            return null;
        }
    }).filter(mod => mod !== null);
}

function loadModuleInfo(rootFolder, name) {
    const modulePath = path.join(rootFolder, name);

    let result = {
        name: name.toLowerCase(),
        rawName: name,
        path: modulePath,
        keywords: [],
        author: null,
        description: null,
        version: null,
        donationUrl: null,
        options: {},
        drmKey: null,
        supportUrl: null,
        disabled: false,
        disableAutoUpdate: null,
        dependencies: [],
        conflicts: [],
        packets: {},
    };

    const standalone = !fs.statSync(modulePath).isDirectory();
    if (standalone) {
        if (!name.endsWith(".js"))
            throw new Error(`Invalid mod ${name}`);

        // Standalone legacy mod
        Object.assign(result, {
            'type': 'standalone',
            'compatibility': 'legacy',
        });
    } else {
        // Try to load module information and manifest files
        let moduleInfo = null;
        try {
            moduleInfo = fs.readFileSync(path.join(modulePath, 'module.json'), 'utf8');
        } catch (_) {
            // Files not found, so regular legacy mod
            Object.assign(result, {
                'type': 'regular',
                'compatibility': 'legacy',
            });
        }

        // Parse and load module information
        if (moduleInfo) {
            moduleInfo = JSON.parse(moduleInfo);

            Object.assign(result, {
                type: 'regular',
                compatibility: 'compatible',
                keywords: moduleInfo.keywords || result.keywords,
                name: (moduleInfo.name || result.name).toLowerCase(),
                rawName: moduleInfo.name || result.rawName,
                author: moduleInfo.author || result.author,
                description: moduleInfo.description || result.description,
                version: moduleInfo.version || result.version,
                donationUrl: moduleInfo.donationUrl || result.donationUrl,
                options: moduleInfo.options || result.options,
                drmKey: moduleInfo.drmKey || result.drmKey,
                supportUrl: moduleInfo.supportUrl || result.supportUrl,
                dependencies: moduleInfo.dependencies ? Object.keys(moduleInfo.dependencies) : result.dependencies,
                conflicts: moduleInfo.conflicts || result.conflicts,
                disableAutoUpdate: !!moduleInfo.disableAutoUpdate,
                disabled: !!moduleInfo.disabled,
            });

            // Legacy compatibility
            if (result.options && result.options.niceName) {
                if (global.TeraProxy.DevMode)
                    console.warn(`module.json uses deprecated "options.niceName". Please use "options.cliName" instead (${result.rawName})`);
                result.options.cliName = result.options.niceName;
                delete result.options.niceName;
            }

            if (moduleInfo.category) {
                if (!['network', 'client'].includes(moduleInfo.category))
                    throw new Error(`Invalid mod category ${moduleInfo.category} (${result.rawName})`);

                if (global.TeraProxy.DevMode)
                    console.warn(`module.json uses deprecated "category". Please use "keywords" and the new mod interface instead (${result.rawName})`);

                if (!result.keywords.includes(moduleInfo.category))
                    result.keywords.push(moduleInfo.category);
            } else {
                if (!result.keywords.includes('network'))
                    result.keywords.push('network');
            }

            // Try to load required defs from manifest
            if (result.keywords.includes('network')) {
                let moduleManifest = null;
                try {
                    moduleManifest = JSON.parse(fs.readFileSync(path.join(modulePath, 'manifest.json'), 'utf8'));
                    result.packets = moduleManifest.defs || result.packets;
                } catch (_) {
                    // Ignore
                }
            }

            // Try to load module config
            let moduleConfig = null;
            try {
                moduleConfig = fs.readFileSync(path.join(modulePath, 'module.config.json'), 'utf8');
            } catch (_) {
                // Ignore
            }

            if (moduleConfig) {
                moduleConfig = JSON.parse(moduleConfig);
                result.disabled = moduleConfig.disabled !== undefined ? moduleConfig.disabled : result.disabled;
                result.disableAutoUpdate = moduleConfig.disableAutoUpdate !== undefined ? moduleConfig.disableAutoUpdate : result.disableAutoUpdate;
                result.drmKey = (moduleConfig.drmKey !== undefined && moduleConfig.drmKey !== null) ? moduleConfig.drmKey : result.drmKey;
            }

            // Try to detect readme file path
            let moduleReadme = null;
            try {
                let files = fs.readdirSync(modulePath);

                for(let file of files) {
                    if(readmeFileNames.indexOf(file.toLowerCase()) !== -1) {
                        moduleReadme = path.join(modulePath, file);
                        break;
                    }
                };
            } catch (_) {
                // Ignore
            }

            if (moduleReadme) {
               result.readmePath = moduleReadme;
            }
        }
    }

    // Post-process data
    result.isCoreModule = isCoreModule(result);
    return result;
}


// Module auto update settings management
function _loadModuleConfigFile(moduleInfo) {
    if (moduleInfo.compatibility !== 'compatible')
        throw new TypeError(`Trying to change configuration for incompatible module ${moduleInfo.name}!`);

    try {
        return JSON.parse(fs.readFileSync(path.join(moduleInfo.path, 'module.config.json'), 'utf8'));
    } catch (e) {
        let res = {};
        res.disabled = !!moduleInfo.disabled;
        res.disableAutoUpdate = !!moduleInfo.disableAutoUpdate;
        // Note: we explicitly do not want to set drmKey here, in order to stay compatible with mods that specify it in module.json
        return res;
    }
}

function _storeModuleConfigFile(moduleInfo, data) {
    if (moduleInfo.compatibility !== 'compatible')
        throw new TypeError(`Trying to change configuration for incompatible module ${moduleInfo.name}!`);

    fs.writeFileSync(path.join(moduleInfo.path, 'module.config.json'), JSON.stringify(data, null, 4));
}


function setAutoUpdateEnabled(moduleInfo, enabled) {
    let moduleConfigFile = _loadModuleConfigFile(moduleInfo);
    moduleConfigFile.disableAutoUpdate = !enabled;
    _storeModuleConfigFile(moduleInfo, moduleConfigFile);
}

function enableAutoUpdate(moduleInfo) {
    setAutoUpdateEnabled(moduleInfo, true);
}

function disableAutoUpdate(moduleInfo) {
    setAutoUpdateEnabled(moduleInfo, false);
}

function toggleAutoUpdate(moduleInfo) {
    setAutoUpdateEnabled(moduleInfo, moduleInfo.disableAutoUpdate);
}


function setLoadEnabled(moduleInfo, enabled) {
    let moduleConfigFile = _loadModuleConfigFile(moduleInfo);
    moduleConfigFile.disabled = !enabled;
    _storeModuleConfigFile(moduleInfo, moduleConfigFile);
}

function enableLoad(moduleInfo) {
    setLoadEnabled(moduleInfo, true);
}

function disableLoad(moduleInfo) {
    setLoadEnabled(moduleInfo, false);
}

function toggleLoad(moduleInfo) {
    setLoadEnabled(moduleInfo, moduleInfo.disabled);
}


module.exports = { CoreModules, isCoreModule, listModules, listModuleInfos, loadModuleInfo, installModule, uninstallModule, setAutoUpdateEnabled, enableAutoUpdate, disableAutoUpdate, toggleAutoUpdate, setLoadEnabled, enableLoad, disableLoad, toggleLoad };

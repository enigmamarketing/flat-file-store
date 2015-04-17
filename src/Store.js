/*jslint node:true, unparam: true */
'use strict';
/*global setImmediate */

var fs = require('fs-extra'),
    path = require('path'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    copyVal,
    loadFile,
    Obj;

// in js all objects are passed by reference.
// sometimes this fact gets forgotten when we're dealing with in-memory 
// stores. 
copyVal = function (obj) {
    var val;
    try {
        val = JSON.parse(JSON.stringify(obj));
    } catch (ignore) {}
    return val;
};

loadFile = function (path, createFile, cb) {
    var flags = createFile ? 'a+' : 'r+';

    fs.open(path, flags, function (err, fd) {
        if (err) {
            return cb(err);
        }

        fs.fstat(fd, function (err, stats) {
            var bufferSize = stats.size,
                chunkSize = 512,
                buffer = new Buffer(bufferSize),
                bytesRead = 0;

            if (err) {
                return cb(err);
            }

            function readChunk() {
                if (bytesRead < bufferSize) {
                    if ((bytesRead + chunkSize) > bufferSize) {
                        chunkSize = (bufferSize - bytesRead);
                    }
                    fs.read(fd, buffer, bytesRead, chunkSize, bytesRead, function (err) {
                        if (err) {
                            fs.close(fd);
                            return cb(err);
                        }
                        bytesRead += chunkSize;
                        setImmediate(readChunk);
                    });
                } else {
                    fs.close(fd);
                    cb(null, buffer.toString('utf8', 0, bufferSize));
                }
            }
            readChunk();
        });
    });
};

Obj = function (opts) {
    var self = this;
    if (!opts) {
        opts = {};
    }
    self.ttl = +opts.ttl || 1000;
    self.keepVersions = +opts.keepVersions || 0;
    self.format = opts.format || 'json';
    self.parser = require('./parsers/' + self.format);
    self.createFile = opts.createFile || false;
};

util.inherits(Obj, EventEmitter);

// data parser
Obj.prototype.parser = null;
// file format. makara or json
Obj.prototype.format = null;
// file path
Obj.prototype.file = null;
// ttl between saves to disk
Obj.prototype.ttl = null;
// timer used between saves
Obj.prototype.timer = null;
// cached file data
Obj.prototype.store = null;
// create file if it doesn't exist
Obj.prototype.createFile = null;

Obj.prototype.open = function (file) {
    var self = this;

    if (!file) {
        return self.emit('error', new Error('A file path must be provided'));
    }

    self.file = file;
    // load file
    loadFile(self.file, self.createFile, function (err, data) {
        var stringData;

        if (err) {
            return self.emit('error', err);
        }

        try {
            // deals with files that include BOM
            // thanks https://www.npmjs.org/package/nconf
            stringData = data.toString();

            if (stringData.charAt(0) === '\uFEFF') {
                stringData = stringData.substr(1);
            }

            self.store = self.parser.decode(stringData);
        } catch (e) {
            return self.emit('error', new Error("Error parsing your data file: [" + self.file + '].'));
        }

        self.emit('loaded');
    });
    return self;
};

Obj.prototype.close = function (cb) {
    var self = this;
    //save one last time, just to be sure
    self.save(function (err) {
        self.file = null;
        cb(err);
    });
    return self;
};

Obj.prototype.save = function (cb) {
    var self = this;
    // never save and empty store.
    if (!self.store) {
        if (cb) {
            cb(new Error('Store isn\'t loaded'));
        } // no else! no need to emit this error

        return self;
    }

    if (self.timer) {
        clearTimeout(self.timer);
        self.timer = null;
    }
    self.createVersion(function () {
        fs.writeFile(self.file, self.parser.encode(self.store), function (err) {
            if (cb) {
                cb(err || null);
            } else {
                if (err) {
                    return self.emit('error', err);
                }
            }
            self.emit('saved');
        });
    });
    return self;
};

Obj.prototype.createVersion = function (cb) {
    var self = this,
        versionsFolder,
        backupFile;
    if (!self.keepVersions) {
        return cb();
    }

    versionsFolder = path.join(path.dirname(self.file), '.' + path.basename(self.file));
    backupFile = path.join(versionsFolder, +new Date() + '.bak');
    fs.copy(self.file, backupFile, function (err) {
        if (err) {
            return self.emit('error', err);
        }
        cb();
        //delete old versions
        fs.readdir(versionsFolder, function (err, files) {
            var delFiles;
            if (err) {
                return self.emit('error', err);
            }
            delFiles = files.sort().slice(self.keepVersions, files.length);

            delFiles.forEach(function (file) {
                fs.remove(path.join(versionsFolder, file));
            });
        });
    });

};

Obj.prototype.get = function (key, cb) {
    var self = this;
    if (!cb) {
        self.emit('error', new Error('A callback function must be provided'));
        return self;
    }
    if (!key) {
        cb(new Error('unable to set an undefined or empty key'));
        return self;
    }
    if (self.store) {
        cb(null, copyVal(self.store[key]));
    } else {
        self.once('loaded', function () {
            self.get(key, cb);
        });
    }
    return self;
};

Obj.prototype.set = function (key, value, cb) {
    var self = this,
        err;
    if (key === undefined) {
        err = new Error('unable to set an undefined or empty key');
    }
    if (value === undefined) {
        err = new Error('unable to set an undefined value ' + key);
    }
    if (err) {
        if (cb) {
            cb(err);
        } else {
            self.emit('error', err);
        }
        return self;
    }

    if (self.store) {
        //no point saving if the data is the same
        if (self.store[key] === value) {
            return cb && cb();
        }
        self.store[key] = copyVal(value);

        if (!self.timer) {
            self.timer = setTimeout(self.save.bind(self), self.ttl);
        }
        // callback when it's really saved in disk
        if (cb) {
            self.once('saved', function () {
                cb();
            });
        }
    } else {
        self.once('loaded', function () {
            self.set(key, value);
        });
    }
    return self;
};

Obj.prototype.remove = function (key, cb) {
    var self = this,
        err;

    if (key === undefined) {
        err = new Error('Undefined key');

        if (cb) {
            cb(err);
        } else {
            self.emit('error', err);
        }
        return self;
    }

    if (self.store) {
        delete self.store[key];

        if (!self.timer) {
            self.timer = setTimeout(self.save.bind(self), self.ttl);
        }
        // callback when it's really saved in disk
        if (cb) {
            self.once('saved', function (err) {
                cb(err || null);
            });
        }
    } else {
        self.once('loaded', function () {
            self.remove(key, cb);
        });
    }
    return self;
};

Obj.prototype.getAll = function (cb) {
    var self = this;

    if (!cb) {
        return self.emit('error', new Error('A callback function must be provided'));
    }
    if (self.store) {
        cb(null, copyVal(self.store));
    } else {
        self.once('loaded', function () {
            self.getAll(cb);
        });
    }
    return self;
};

Obj.prototype.removeAll = function (cb) {
    var self = this;
    if (!cb) {
        return self.emit('error', new Error('A callback function must be provided'));
    }
    if (self.store) {
        self.store = {};
        if (!self.timer) {
            self.timer = setTimeout(self.save.bind(self), self.ttl);
        }
        cb(null);
    } else {
        self.once('loaded', function () {
            self.removeAll(cb);
        });
    }
    return self;
};

Obj.prototype.createReadStream = function (filterKey) {
    var self = this,
        on,
        processStream,
        setCallback,
        obj,
        index,
        storeElements = Object.keys(self.store),
        regEx;

    if (filterKey) {
        regEx = new RegExp(filterKey);
    }

    index = 0;

    on = {
        data: null,
        end: null
    };

    processStream = function (processNext) {
        var key = storeElements[index],
            item = copyVal(self.store[key]),
            willContinue;

        if (item !== undefined && on.data && processNext !== false) {
            if (!regEx || regEx.test(key)) {
                //if the user returns false we stop the stream
                willContinue = (on.data(item, key) === false ? false : true);
            }
            setImmediate(function () {
                index += 1;
                processStream(willContinue);
            });
        } else {
            if (on.end) {
                on.end();
            }
        }
    };

    setCallback = function (key, cb) {
        if (!on.hasOwnProperty(key)) {
            return self.emit('error', new Error('unable to set method'));
        }
        if (!cb || typeof cb !== 'function') {
            return self.emit('error', new Error('A callback function must be provided'));
        }
        on[key] = cb;

        if (key === 'data') {
            setImmediate(processStream);
        }
        return obj;
    };

    obj = {
        on: setCallback
    };
    return obj;
};

module.exports = Obj;
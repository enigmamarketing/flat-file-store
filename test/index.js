/*jslint node:true, unparam: true, nomen: true */
/*global describe, it, before, after */
'use strict';

var assert = require("assert"),
    path = require('path'),
    fs = require('fs-extra'),
    Store = require('../src/Store');

describe('Store', function () {
    var editor, file;
    before(function (done) {
        // the tests change the data file. We always create a new copy to work on
        var randomName = +new Date() + '.json',
            backupFile = path.join(__dirname, '../fixture/data.json');

        file = path.join(__dirname, '../fixture/tmp/' + randomName);
        fs.remove(path.join(__dirname, '../fixture/tmp/'), function () {
            fs.copy(backupFile, file, function (err) {
                assert.ifError(err);
                editor = new Store();
                editor.open(file).on('loaded', done);
            });
        });
    });

    after(function (done) {
        editor.close(done);
    });

    it('should get item', function (done) {
        editor.get('test', function (err, val) {
            assert.ifError(err);
            assert.equal(val, 'OK');
            done();
        });
    });

    it('should set item', function (done) {
        editor.set('set item', 'OK', function (err, val) {
            assert.ifError(err);
            editor.get('set item', function (err, val) {
                assert.ifError(err);
                assert.equal(val, 'OK');
                done();
            });
        });
    });

    it('should have saved all data', function (done) {
        var data = {};
        editor.createReadStream()
            .on('data', function (item, key) {
                data[key] = item;
            })
            .on('end', function () {
                assert.deepEqual(data, require(file));
                done();
            });
    });
});
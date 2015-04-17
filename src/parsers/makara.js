/*jslint node:true, unparam: true */
'use strict';

var jsonminify = require("jsonminify");

module.exports = {
    encode: function (data) {
        var txt = '';
        Object.keys(data).forEach(function (key) {
            txt += key + '=' + data[key] + '\n';
        });
        return txt;
    },
    decode: function (data) {
        var lines = data.split('\n'),
            obj = {};

        lines.forEach(function (line) {
            var index = line.indexOf('='),
                key,
                value;
            if (index === -1) {
                return;
            }
            key = line.substring(0, index);
            value = line.substring(index + 1, line.length);
            obj[key] = value;
        });
        return obj;
    }
};
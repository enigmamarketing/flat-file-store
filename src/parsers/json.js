/*jslint node:true, unparam: true */
'use strict';

var jsonminify = require("jsonminify");

module.exports = {
    encode: function (data) {
        return JSON.stringify(data, null, 4);
    },
    decode: function (data) {
        return JSON.parse(jsonminify(data));
    }
};
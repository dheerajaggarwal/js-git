/*
 * Module to store git data in chrome.storage.local
 */

"use strict";

var bodec = require('bodec');
var codec = require('../lib/object-codec.js');
var sha1 = require('git-sha1');
var inflate = require('../lib/inflate');
var deflate = require('../lib/deflate');
var modes = require('../lib/modes');

module.exports = mixin;

function mixin(repo, prefix) {
  var local = chrome.storage.local;

  if (!prefix) throw new Error("Prefix required...");
  repo.prefix = prefix;
  repo.saveAs = saveAs;
  repo.loadAs = loadAs;
  repo.saveRaw = saveRaw;
  repo.loadRaw = loadRaw;
  repo.hasHash = hasHash;
  repo.readRef = readRef;
  repo.updateRef = updateRef;


  /*
   * Internal method to get the object from the chrome.storage.local
   */
  function get(key, callback) {
    if (!callback) return get.bind(this, key);
    var preKey = key;
    if(repo.prefix){
      preKey = repo.prefix + '/' + key;
    }
    return local.get(preKey, function (items) {
      if (chrome.runtime.lastError) {
        return callback(new Error(chrome.runtime.lastError.message));
      }
      if (!(preKey in items)) {
        var err = new Error("ENOENT: " + key + " not in database.");
        err.code = "ENOENT";
        return callback(err);
      }
      return callback(null, items[preKey]);
    });
  }

  /*
   * Internal method to store the git object to chrome.storage.local
   */
  function set(key, value, callback) {
    if (!callback) return set.bind(this, key, value);
    var preKey = key;
    if(repo.prefix){
      preKey = repo.prefix + '/' + key;
    }
    var q = {};
    q[preKey] = value;
    local.set(q, onSet);
    function onSet() {
      if (chrome.runtime.lastError) {
        return callback(new Error(chrome.runtime.lastError.message));
      }
      return callback();
    }
  }

  /*
   * Method to read git reference from storage
   */
  function readRef(ref, callback) {
    if (!callback) return readRef.bind(this, ref);
    get(ref, callback);
  }

  /*
   * Method to update git reference in storage
   */
  function updateRef(ref, hash, callback) {
    if (!callback) return updateRef.bind(this, ref, hash);
    set(ref, hash, callback);
  }

  /*
   * Method to check whether the hash is in the storage or not
   */
  function hasHash(hash, callback) {
    if (!callback) return hasHash.bind(this, hash);
    loadRaw(hash, function (err, body) {
      if (err) return callback(err);
      return callback(null, !!body);
    });
  }

  /*
   * Method to save the git object based on type
   */
  function saveAs(type, body, callback, forcedHash) {
    if (!callback) return saveAs.bind(this, type, body);
    var hash, buffer;
    try {
      buffer = codec.frame({type: type, body: body});
      hash = sha1(buffer);
    }
    catch (err) { return callback(err); }
    this.saveRaw(hash, buffer, callback);
  }

  /*
   * Method to save the raw git object - hash and buffer
   */
  function saveRaw(hash, buffer, callback) {
    /*jshint: validthis: true */
    if (!callback) return saveRaw.bind(this, hash, buffer);
    return set(hash, bodec.toBase64(deflate(buffer)), function(err){
      if(err) return callback(err);
      return callback(null, hash);
    });
  }

  /*
   * Method to load the git object based on type
   */
  function loadAs(type, hash, callback) {
    if (!callback) return loadAs.bind(this, type, hash);
    loadRaw(hash, function (err, buffer) {
      if (!buffer) return callback(err);
      var obj = codec.deframe(buffer, true);
      if (type && type !== obj.type)
        return callback(new TypeError("Type mismatch, Expected `" + type + "` Found `" + obj.type + "`"));
      callback(null, obj.body, hash);
    });
  }

  /*
   * Method to load the raw git object based on hash
   */
  function loadRaw(hash, callback) {
    if (!callback) return loadRaw.bind(this, hash);
    return get(hash, function(err, value){
      if(err) return callback(err);
      return callback(null, inflate(bodec.fromBase64(value)));
    });
  }
}
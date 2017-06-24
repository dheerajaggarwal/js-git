/*
 * Module to clone the git repository
 * Code is picked from https://github.com/creationix/clone-test/blob/master/src/main.js
 * and converted into the mixin
 */

"use strict";

var consume = require('culvert/consume');
var fetchPackProtocol = require('../net/git-fetch-pack');

module.exports = mixin;

function mixin(repo) {
  repo.clone = clone;

  function onRefs(api, refs, options){
    if (options.onRefs) {
      options.onRefs(refs);
    }

    var wants;
    if (options.wants) {
      if (typeof options.wants === "function") {
        wants = options.wants(refs);
      }
      else if (Array.isArray(options.wants)) {
        wants = options.wants;
      }
      else {
        throw new TypeError("Invalid options.wants type");
      }
    }
    else wants = Object.keys(refs);

    wants.forEach(function (want) {
      // Skip peeled refs
      if (/\^\{\}$/.test(want)) return;
      // Ask for the others
      api.put({want: refs[want]});
    });
    if (options.depth) {
      api.put({deepen: options.depth});
    }
    api.put(null);
    api.put({done: true});
    api.put();

    return wants;
  }

  function onChannels(channels, wants, refs, options, callback){
    var unpack = function(err, hashes){
      if(err) return callback(err);
      return onUnpack(hashes, wants, refs, callback);
    };
    if (options.onProgress) {
      if (typeof options.onProgress !== "function") {
        throw new TypeError("options.onProgress must be function");
      }
      consume(channels.progress, options.onProgress),
      repo.unpack(channels.pack, options, unpack);
    }
    else {
      repo.unpack(channels.pack, options, unpack);
    }
  }

  function onUnpack(hashes, wants, refs, callback){
    return updateRef(0, wants, refs, callback);
  }

  function updateRef(index, wants, refs, callback){
    if(index === wants.length) return callback(null, refs);
    var name = wants[index];
    if (name === "HEAD" || !refs[name]) {
      index++;
      return updateRef(index, wants, refs, callback);
    } else {
      repo.updateRef(name, refs[name], function(err, hash){
        if(err) return callback(err);
        index++;
        return updateRef(index, wants, refs, callback);
      });  
    }
  }

  function clone(transport, options, callback) {
    console.log(transport);
    // Start a fetch-pack request over the transport
    var api = fetchPackProtocol(transport);

    // Get the refs on the remote
    api.take(function(err, refs){
      if(err) return callback(err);
      var wants = onRefs(api, refs, options);

      api.take(function(err, channels){
        if(err) return callback(err);
        return onChannels(channels, wants, refs, options, callback);
      });
    });
  }
};
"use strict";

var makeChannel = require('culvert');
var wrapHandler = require('../lib/wrap-handler');
var bodec = require('bodec');

module.exports = receivePack;

function receivePack(transport, onError) {

  if (!onError) onError = throwIt;

  // Wrap our handler functions to route errors properly.
  onRef = wrapHandler(onRef, onError);
  onPackFile = wrapHandler(onPackFile, onError);
  onResponse = wrapHandler(onResponse, onError);

  var caps = null;
  var capsSent = false;
  var startPack = false;
  var refs = {};

  // Create a duplex channel for talking with the agent.
  var libraryChannel = makeChannel();
  var agentChannel = makeChannel();
  var api = {
    put: libraryChannel.put,
    drain: libraryChannel.drain,
    take: agentChannel.take
  };

  // Start the connection and listen for the response.
  var socket = transport("git-receive-pack", onError);
  socket.take(onRef);

  // Return the other half of the duplex API channel.
  return {
    put: agentChannel.put,
    drain: agentChannel.drain,
    take: libraryChannel.take
  };

  function onRef(line) {
    if (line === undefined) {
      throw new Error("Socket disconnected");
    }
    if (line === null) {
      api.put(refs);
      api.take(onPackFile);
      return;
    }
    else if (!caps) {
      caps = {};
      Object.defineProperty(refs, "caps", {value: caps});
      Object.defineProperty(refs, "shallows", {value:[]});
      var index = line.indexOf("\0");
      if (index >= 0) {
        line.substring(index + 1).split(" ").forEach(function (cap) {
          var i = cap.indexOf("=");
          if (i >= 0) {
            caps[cap.substring(0, i)] = cap.substring(i + 1);
          }
          else {
            caps[cap] = true;
          }
        });
        line = line.substring(0, index);
      }
    }
    var match = line.match(/(^[0-9a-f]{40}) (.*)$/);
    if (!match) {
      if (typeof line === "string" && /^ERR/i.test(line)) {
        throw new Error(line);
      }
      throw new Error("Invalid line: " + JSON.stringify(line));
    }
    refs[match[2]] = match[1];
    socket.take(onRef);
  }
  
  function onPackFile(line) {
    if (line === undefined){
      socket.put("done\n");
      return socket.take(onResponse);
    } 
    if (line.update || line.create || line.delete) {
      var cmd = line.update || line.create || line.delete;
      var extra = "", zeroId = "0000000000000000000000000000000000000000";
      cmd.oldHash = cmd.oldHash || zeroId;
      cmd.newHash = cmd.newHash || zeroId;
      if (!capsSent) {
        extra = "\0";
        capsSent = true;
        if (caps["report-status"]) extra += " report-status";
        if (caps["side-band-64k"]) extra += " side-band-64k";
        else if (caps["side-band"]) extra += " side-band";
        if (caps.agent) extra += " agent=" + caps.agent;
      }
      extra += "\n";
      socket.put(cmd.oldHash + " " + cmd.newHash + " " + cmd.ref + extra);
      return api.take(onPackFile);
    }
    if(line.pack){
      startPack = true;
      socket.put(null);
      socket.put("PACK");
      return api.take(onPackFile)
    }
    if(startPack){
      socket.put(line.item);
      return api.take(onPackFile);
    }
    throw new Error("Invalid command");
  }

  function onResponse(line) {
    if (line === undefined) return console.log("Push done ...");
    else {
      console.log("Response Line: ", line);
      socket.take(onResponse);
    }
    //throw new Error("Unexpected Response...");
  }
}

var defer = require('../lib/defer');
function throwIt(err) {
  defer(function () {
    throw err;
  });
  // throw err;
}
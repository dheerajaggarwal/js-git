/*
 * Module to push into the git repository
 */

"use strict";

var consume = require('culvert/consume');
var receivePackProtocol = require('../net/git-receive-pack');
var modes = require('../lib/modes');

module.exports = mixin;

function mixin(repo) {
  repo.push = push;
  repo.getHashes = getHashes;

  function getHashes(srcHash, targetHash, callback){
    var seen = {}, hashes = [];

    seen[targetHash] = true;

    return getDiff(srcHash, hashes, seen, function(err){
      if(err) return callback(err);
      return callback(null, hashes);
    });

    function addTreeObjectsToDiff(treeHash, hashes, callback){
      if(!hashes[treeHash]) hashes.push(treeHash);
      repo.loadAs("tree", treeHash, function(err, tree){
        if(err) return callback(err);
        var keys = Object.keys(tree), i = 0;
        return forEachKey(i);

        function cb(err){
          if(err) return callback(err);
          i++;
          if(i === keys.length){
            return callback();
          } else {
            return forEachKey(i);
          }
        }

        function forEachKey(index){
          var key = keys[index];
          var obj = tree[key];
          if(obj.mode === modes.blob){
            if(!hashes[obj.hash]) hashes.push(obj.hash);
            return cb();
          } else if(obj.mode === modes.tree){
            return addTreeObjectsToDiff(obj.hash, hashes, cb);
          }
        }
      });
    }

    function getTreeHashDiff(srcHash, targetHash, hashes, callback){
      if(!hashes[srcHash]) hashes.push(srcHash);
      repo.loadAs("tree", srcHash, function(err, srcTree){
        if(err) return callback(err);
        repo.loadAs("tree", targetHash, function(err, targetTree){
          if(err) return callback(err);
          return getTreeDiff(srcTree, targetTree, hashes, callback);
        });
      });
    }

    function getTreeDiff(src, target, hashes, callback){
      var keys = Object.keys(src), i = 0;
      return forEachKey(i);

      function cb(err){
        if(err) return callback(err);
        i++;
        if(i === keys.length){
          return callback();
        } else {
          return forEachKey(i);
        }
      }

      function forEachKey(index){
        var key = keys[index],
          srcObj = src[key], targetObj = target[key];
        if(!targetObj || targetObj.hash !== srcObj.hash){ //if hash doesn't match or hash doesn't exist earlier
          if(srcObj.mode === modes.blob){ //new file or updated file
            if(!hashes[srcObj.hash]) hashes.push(srcObj.hash);
          } else if(srcObj.mode === modes.tree){
            if(!targetObj){ //if new directory
              return addTreeObjectsToDiff(srcObj.hash, hashes, cb);
            } else {
              return getTreeHashDiff(srcObj.hash, targetObj.hash, hashes, cb);
            }
          }
        }
        return cb(null);
      }
    }

    function getDiffInCommits(src, target, hashes, callback){
      var srcTree = src.tree, targetTree = target.tree;

      return getTreeHashDiff(srcTree, targetTree, hashes, callback);
    }

    function getDiff(commitHash, hashes, seen, callback){
      if(seen[commitHash]) return callback();
      if(!hashes[commitHash]) hashes.push(commitHash);
      seen[commitHash] = true;
      repo.loadAs("commit", commitHash, function(err, commit){
        if(err) return callback(err);
        var tree = commit.tree,
          parents = commit.parents, i = 0;

          return forEachParent(i);

          function cb(err){
            if(err) return callback(err);
            i++;
            if(i === parents.length){
              return callback();
            } else {
              return forEachParent(i);
            }
          }

          function forEachParent(index){
            var parent = parents[index];
            repo.loadAs("commit", parent, function(err, parentCommit){
              if(err) return callback(err);
              return getTreeHashDiff(tree, parentCommit.tree, hashes, function(err){
                if(err) return callback(err);
                return getDiff(parent, hashes, seen, cb);
              });
            });
          }
      });
    }
  }

  function onRefs(api, refs, options, callback){
    if (options.onRefs) {
      options.onRefs(refs);
    }

    var srcBranch = "refs/heads/" + (options.srcBranch || "master"),
      targetBranch = "refs/heads/" + (options.targetBranch || "master");
    var targetRef = refs[targetBranch];
    if(!targetRef){
      throw new TypeError("Remote branch not found.");
    }
    repo.readRef(srcBranch, function(err, hash){
      if(err) throw new TypeError("Source branch not found.");
      repo.getHashes(hash, targetRef, function(err, hashes){
        if(err) return callback(err);
        if(hashes.length){
          api.put({"update": {oldHash: targetRef, newHash: hash, ref: targetBranch}});
          api.put({pack: true});
          repo.pack(hashes, {}, function(err, stream){
            if(err) return callback(err);
            stream.take(onRead);
            function onRead(err, item) {
              if(err) return callback(err);
              if(item){
                api.put({item: item});
                stream.take(onRead);
              } else {
                api.put();
              }
            }
          });
        } else {
          throw new TypeError("Nothing to update.");
        }
      });
    });
  }

  function push(transport, options, callback) {
    // Start a fetch-pack request over the transport
    var api = receivePackProtocol(transport);

    // Get the refs on the remote
    api.take(function(err, refs){
      if(err) return callback(err);
      onRefs(api, refs, options, callback);
    });
  }
};
var async = require('async');
var dropbox = require('dropbox');
var events = require('events');
var mongodb = require('mongodb');
var sharejs = require('share');

var config = require('./config');

//
// connect to MongoDB
//
var mongo = function(callback) { mongo.state.on('auth', callback); };
mongo.state = new events.EventEmitter();
(function () {
  mongo.state.once('auth', function() {
    mongo = function(callback) { callback(null, db); }
  });
  var db = new mongodb.Db(config.mongodb.db,
                          new mongodb.Server(config.mongodb.hostname, config.mongodb.port, config.mongodb.mongoOptions),
                          { safe: true });
  db.open(function(err, db) {
    db.authenticate(config.mongodb.user, config.mongodb.password, function(err, results) {
      if (err) { console.error('Error authenticating to MongoDB', err); }
      db.collection('users', function(err, users) { users.ensureIndex({ username: 1 }, { unique: true }, function(err) {
        if (err) { console.error('Error creating username index', err); }
        else { console.log('Authenticated to MongoDB'); }
      }); });
      mongo.state.emit('auth', err, db);
    });
  });
})();

//
// ShareJS
//
var share = sharejs.server.createModel({ db: { type: 'none' } });

exports.attach = function(app) {
  console.log('Attaching ShareJS routes');
  
  sharejs.server.attach(app, {
    browserChannel: { cors: 'https://' + config.web.host + ':' + config.web.https },
    auth: function(agent, action) {
      if ( ! action.docName) { return action.accept(); }
      if ( ! /^\w+~\w+\.\w+$/.test(action.docName)) { return action.reject(); }
      
      var parts = action.docName.split('~');
      var projectID = parts[0], file = parts[1];
      if (false) { // TODO check that this user can edit this document
        return action.reject();
      }
      action.accept();
      if (action.name == 'create') {
        mongo(function(err, db) {
          if (err) { console.error('Error restoring document', err, action); }
          else { db.restoreProjectDocument(projectID, file, function() {}); }
        });
      }
    }
  }, share);
};

//
// database operations
//

exports.findUser = function(username, callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    db.collection('users', function(err, users) {
      if (err) { return callback(err); }
      var user = { username: username };
      users.findAndModify(user, [], { $set: user }, { w: 1, new: true, upsert: true }, callback);
    });
  });
};

exports.saveUser = function(user, callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    db.collection('users', function(err, users) {
      if (err) { return callback(err); }
      users.update({ username: user.username }, { $set: user }, { w: 1 }, callback);
    });
  });
};

exports.exercises = function(callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    db.collection('exercises', function(err, exercises) {
      if (err) { return callback(err); }
      exercises.find().toArray(callback);
    });
  });
};

exports.findExercise = function(exerciseID, callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    db.collection('exercises', function(err, exercises) {
      if (err) { return callback(err); }
      exercises.findOne({ _id: new mongodb.ObjectID(exerciseID) }, callback);
    });
  });
};

exports.newExercise = function(exercise, callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    db.collection('exercises', function(err, exercises) {
      if (err) { return callback(err); }
      exercises.insert(exercise, { w: 1 }, callback);
    });
  });
};

exports.projects = function(username, callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    db.collection('projects', function(err, projects) {
      if (err) { return callback(err); }
      projects.find({ users: username }, {}).toArray(callback);
    });
  });
}

exports.findProject = function(projectID, callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    db.collection('projects', function(err, projects) {
      if (err) { return callback(err); }
      projects.findOne({ _id: new mongodb.ObjectID(projectID) }, function(err, project) {
        callback(err, project);
      });
    });
  });
};

exports.joinProject = function(projectOID, exerciseID, username, callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    exports.findExercise(exerciseID, function(err, exercise) {
      if (err || ! exercise) { return callback(err || new Error('unknown exercise')); }
      db.ensureProject(projectOID, exercise, function(err) {
        if (err) { return callback(err); }
        db.addUserToProject(projectOID, username, function(err, project) {
          callback(err, project);
        });
      });
    });
  });
};

exports.saveProject = function(projectID, callback) {
  mongo(function(err, db) {
    if (err) { return callback(err); }
    exports.findProject(projectID, function(err, project) {
      if (err) { return callback(err); }
      db.collection('files', function(err, files) {
        if (err) { return callback(err); }
        async.map(project.exercise.files, function(filename, set) {
          share.getSnapshot(project._id + '~' + filename, function(err, state) {
            files.update({
              projectID: project._id, filename: filename
            }, { $set: { data: state.snapshot } }, { w: 1 }, function(err) {
              set(err, { filename: filename, data: state.snapshot });
            });
          });
        }, function(err, files) {
          callback(err, project, files);
        });
      });
    });
  });
};

mongodb.Db.prototype.ensureProject = function(projectOID, exercise, callback) {
  var db = this;
  db.collection('projects', function(err, projects) {
    if (err) { return callback(err); }
    projects.insert({
      _id: projectOID,
      exercise: exercise,
      users: []
    }, { w: 1 }, function(err, result) {
      if ( ! err) { db.initProjectDocuments(projectOID, function(err) {
        if (err) { console.error('Error initializing documents', projectOID, err); }
      }); }
      callback();
    });
  });
};

mongodb.Db.prototype.addUserToProject = function(projectOID, username, callback) {
  this.collection('projects', function(err, projects) {
    projects.findAndModify({ _id: projectOID }, [], {
      $push: { users: username }
    }, { w: 1, new: true }, function(err, project) {
      callback(err, project);
    });
  });
};

mongodb.Db.prototype.initProjectDocuments = function(projectOID, callback) {
  var db = this;
  exports.findProject(projectOID.toString(), function(err, project) {
    if (err) { return callback(err); }
    exports.findUser(project.exercise.creator, function(err, creator) {
      if (err) { return callback(err); }
      exports.dropbox(creator, function(err, drop) {
        if (err) { return callback(err); }
        async.each(project.exercise.files, function(file, next) {
          db.initProjectDocument(project, drop, file, next);
        }, function(err) {
          callback(err);
        });
      });
    });
  });
};

mongodb.Db.prototype.initProjectDocument = function(project, drop, filename, callback) {
  var db = this;
  drop.readJavaFile(project.exercise.folder + '/' + filename, function(err, data) {
    if (err) { return callback(err); }
    share.create(project._id + '~' + filename, 'text', {}, function(err, doc) {
      share.applyOp(project._id + '~' + filename, { op: [ { i: data, p: 0 } ], v: 0 }, function(err, v) {
        db.collection('files', function(err, files) {
          if (err) { return callback(err); }
          files.update({
            projectID: project._id, filename: filename
          }, {
            projectID: project._id, filename: filename, data: data
          }, { upsert: true, w: 1 }, function(err) {
            callback(err);
          });
        });
      });
    });
  });
};

mongodb.Db.prototype.restoreProjectDocument = function(projectID, filename, callback) {
  var db = this;
  exports.findProject(projectID, function(err, project) {
    if (err) { return callback(err); }
    db.collection('files', function(err, files) {
      if (err) { return callback(err); }
      files.findOne({
        projectID: project._id, filename: filename
      }, function(err, file) {
        if ( ! file) { return callback(); }
        share.applyOp(projectID + '~' + filename, { op: [ { i: file.data, p: 0 } ], v: 0 }, function(err, v) {
          callback(err);
        });
      });
    });
  });
};

//
// Dropbox operations
//

exports.dropbox = function(user, callback) {
  if ( ! user.dropbox) { return callback(new Error('No Dropbox token')); }
  var client = new dropbox.Client({
    key: config.dropbox.key,
    secret: config.dropbox.secret,
    token: user.dropbox
  });
  callback(null, client);
};

dropbox.Client.prototype.findAllJavaFiles = function(callback) {
  this.findByName('/', '.java', {}, callback);
};

dropbox.Client.prototype.findJavaFiles = function(path, callback) {
  this.readdir(path, {}, function(err, filenames, folder, files) {
    if (files) {
      files = files.filter(function(file) { return file.isFile && /\.java$/.test(file.name); });
    }
    callback(err, folder, files);
  });
};

dropbox.Client.prototype.readJavaFile = function(path, callback) {
  this.readFile(path, {}, function(err, data, stat) {
    callback(err, data.replace(/\r\n/g, '\n'), stat);
  });
};

dropbox.Client.prototype.createJavaDocs = function(project, callback) {
  async.each(project.exercise.files, (function(file, next) {
    this.readFile(project.exercise.folder + '/' + file, {}, function(err, data, stat) {
      if (err) { return next(err); }
      
      next();
    });
  }).bind(this), callback);
};

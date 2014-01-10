var async = require('async');
var connect_utils = require('express/node_modules/connect/lib/utils');
var express = require('express');
var fs = require('fs');
var https = require('https');
var jade = require('jade');
var jade_browser = require('jade-browser');
var path = require('path');

var config = require('./config');

var auth = require('./auth');
var java = require('./java');
var join = require('./join');
var workspace = require('./workspace');

var app = express();

app.set('view engine', 'jade');

app.use('/static', express.static(path.join(__dirname, 'static')));
app.use(jade_browser('/jade/templates.js', '*', {
  root: path.join(__dirname, 'views', 'client'),
  minify: ! config.web.debugViews,
  noCache: config.web.debugViews
}));
app.use(express.logger());
app.use(express.bodyParser());

// use string callbacks to check input against anchored regex
app.param(function(name, fn) {
  if (fn.constructor == String) {
    return function(req, res, next, val) {
      if (val.match('^' + fn + '$')) { next(); } else { next('route'); }
    }
  }
});
app.param('exercise', '[a-f0-9]+');
app.param('project', '[a-f0-9]+');

// all page requests must be authenticated
app.all('*', function(req, res, next) {
  var cert = req.connection.getPeerCertificate();
  if ( ! req.connection.authorized) { return res.status(401).render(401); }
  
  res.locals.authusername = cert.subject.emailAddress.replace('@' + config.web.certDomain, '');
  if (config.web.userFakery) { res.locals.authusername += '+' + connect_utils.md5(req.headers['user-agent']).substr(0,3); }
  res.locals.authstaff = config.staff.indexOf(res.locals.authusername) >= 0;
  next();
});

function staffonly(req, res, next) {
  if (res.locals.authstaff) { return next(); }
  res.status(401).render('401');
}

app.get('/', function(req, res, next) {
  async.auto({
    exercises: workspace.exercises,
    projects: async.apply(workspace.projects, res.locals.authusername)
  }, function(err, results) {
    if (err) { return next(err); }
    res.render('index', results);
  });
});

app.get('/dropbox', function(req, res, next) {
  if ( ! req.query.code) {
    return res.render('dropbox', {
      url: auth.dropbox.getAuthorizeUrl({
        redirect_uri: req.protocol + '://' + req.headers.host + '/dropbox'
      })
    });
  }
  auth.dropbox.getOAuthAccessToken(req.query.code, {
    redirect_uri: req.protocol + '://' + req.headers.host + '/dropbox'
  }, function(err, accessToken) {
    if (err) { return next(err); }
    workspace.saveUser({ username: res.locals.authusername, dropbox: accessToken }, function(err) {
      if (err) { return next(err); }
      res.redirect('/');
    });
  });
});

app.get('/new', staffonly, function(req, res, next) {
  workspace.findUser(res.locals.authusername, function(err, authuser) {
    if (err) { return next(err); }
    if ( ! authuser.dropbox) { return res.redirect('/dropbox'); }
    
    workspace.dropbox(authuser, function(err, drop) {
      if (err) { return next(err); }
      drop.findAllJavaFiles(function(err, files) {
        if (err) { return next(err); }
        var folders = files.map(function(file) {
          return path.dirname(file.path);
        }).filter(function(path, idx, self) {
          return self.indexOf(path) === idx;
        });
        res.render('exercise-new', {
          folders: folders
        });
      });
    });
  });
});

app.get('/new/*', staffonly, function(req, res, next) {
  workspace.findUser(res.locals.authusername, function(err, authuser) {
    if (err) { return next(err); }
    if ( ! authuser.dropbox) { return res.redirect('/dropbox'); }
    
    workspace.dropbox(authuser, function(err, drop) {
      if (err) { return next(err); }
      drop.findJavaFiles(req.params[0], function(err, folder, files) {
        if (err) { return next(err); }
        res.render('exercise-confirm', {
          folder: folder.path,
          components: folder.path.replace(/^\//, '').split('/'),
          files: files.map(function(file) { return file.name; })
        });
      });
    });
  });
});

app.post('/new/*', staffonly, function(req, res, next) {
  workspace.findUser(res.locals.authusername, function(err, authuser) {
    if (err) { return next(err); }
    if ( ! authuser.dropbox) { return res.redirect('/dropbox'); }
    
    if ( ! req.body.package) { return res.status(400).render(400, { error: 'Exercise package required' }); }
    if ( ! req.body.main) { return res.status(400).render(400, { error: 'Exercise main class required' }); }
    if ( ! req.body.title) { return res.status(400).render(400, { error: 'Exercise title required' }); }
    workspace.dropbox(authuser, function(err, drop) {
      if (err) { return next(err); }
      drop.findJavaFiles(req.params[0], function(err, folder, files) {
        if (err) { return next(err); }
        var files = files.map(function(file) { return file.name; });
        if (files.indexOf(req.body.main) < 0) {
          return res.status(400).render(400, { error: 'Main class not found in folder'});
        }
        workspace.newExercise({
          title: req.body.title,
          creator: authuser.username,
          folder: folder.path,
          files: files,
          package: req.body.package.replace(/\.$/, ''),
          main: req.body.main.replace(/\.java$/, '')
        }, function(err) {
          if (err) { return next(err); }
          res.redirect('/');
        });
      });
    });
  });
});

app.get('/ex/:exercise', function(req, res, next) {
  workspace.findExercise(req.params.exercise, function(err, exercise) {
    if (err) { return next(err); }
    if ( ! exercise) { return res.status(404).render(404, { what: 'exercise' }); }
    res.render('exercise', {
      exercise: exercise
    });
  });
});

app.get('/pair/:exercise', function(req, res, next) {
  workspace.findExercise(req.params.exercise, function(err, exercise) {
    if (err) { return next(err); }
    if ( ! exercise) { return res.status(404).render(404, { what: 'exercise' }); }
    res.render('join', {
      exercise: exercise,
      joincode: join.code(req.params.exercise)
    });
  });
});

app.post('/pair/:exercise', function(req, res, next) {
  join.rendezvous(req.params.exercise, req.body.me, req.body.partner, function(err, objID) {
    if (err) { return res.send(400, { error: err.message }); }
    workspace.joinProject(objID, req.params.exercise, res.locals.authusername, function(err, project) {
      if (err) { console.error('Error joining project', err); }
      res.send({ redirect: '/' + project._id });
    });
  });
});

app.get('/:project', function(req, res, next) {
  workspace.findProject(req.params.project, function(err, project) {
    if (err) { return next(err); }
    if ( ! project) { return res.status(404).render(404, { what: 'project '}); }
    if (project.users.indexOf(res.locals.authusername) < 0) { return res.render(401); }
    
    res.render('project', {
      shareURL: req.protocol + '://' + req.host + ':' + config.web.share,
      project: project
    });
  });
});

app.post('/:project/save', function(req, res, next) {
  workspace.saveProject(req.params.project, function(err, project, files) {
    if (err) {
      console.error('Save error', err.stack);
      return res.send(500, { error: 'Error saving project' });
    }
    java.compileAndRun(files, project.exercise.package, project.exercise.main, function(err, result) {
      if (err) {
        console.error('Compile-and-run error', err.stack);
        return res.send(500, { error: 'Error running project' });
      }
      res.send(200, result);
    });
  });
});

app.use(function(err, req, res, next) {
  console.error('Application error:', err.stack);
  res.status(500).render(500);
});

var shareapp = express();
workspace.attach(shareapp);
var share = https.createServer({
  key: fs.readFileSync('./config/ssl-private-key.pem'),
  cert: fs.readFileSync('./config/ssl-certificate.pem'),
  ca: [ fs.readFileSync('./config/ssl-ca.pem') ],
}, shareapp);
share.listen(config.web.share, config.web.host, function() {
  console.log('ShareJS listening on', share.address());
});

var server = https.createServer({
  key: fs.readFileSync('./config/ssl-private-key.pem'),
  cert: fs.readFileSync('./config/ssl-certificate.pem'),
  ca: [ fs.readFileSync('./config/ssl-ca.pem') ],
  requestCert: true
}, app);
server.listen(config.web.https, config.web.host, function() {
  console.log('Express listening on', server.address());
});

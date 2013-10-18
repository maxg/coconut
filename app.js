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
app.param('lang', '\\w+');
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

app.get('/', function(req, res) {
  async.auto({
    exercises: workspace.exercises,
    projects: async.apply(workspace.projects, res.locals.authusername)
  }, function(err, results) {
    if (err) { return res.status(500).render(500); }
    res.render('index', results);
  });
});

app.get('/dropbox', function(req, res) {
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
    if (err) { return res.status(500).render(500); }
    workspace.saveUser({ username: res.locals.authusername, dropbox: accessToken }, function(err) {
      if (err) { return res.status(500).render(500); }
      res.redirect('/');
    });
  });
});

app.get('/new', function(req, res) {
  workspace.findUser(res.locals.authusername, function(err, authuser) {
    if (err) { return res.status(500).render(500); }
    if ( ! authuser.dropbox) { return res.redirect('/dropbox'); }
    
    workspace.dropbox(authuser, function(err, drop) {
      drop.findAllJavaFiles(function(err, files) {
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

app.get('/new/*', function(req, res) {
  workspace.findUser(res.locals.authusername, function(err, authuser) {
    if (err) { return res.status(500).render(500); }
    if ( ! authuser.dropbox) { return res.redirect('/dropbox'); }
    
    workspace.dropbox(authuser, function(err, drop) {
      drop.findJavaFiles(req.params[0], function(err, folder, files) {
        res.render('exercise-confirm', {
          folder: folder.path,
          components: folder.path.replace(/^\//, '').split('/'),
          files: files.map(function(file) { return file.name; })
        });
      });
    });
  });
});

app.post('/new/*', function(req, res) {
  workspace.findUser(res.locals.authusername, function(err, authuser) {
    if (err) { return res.status(500).render(500); }
    if ( ! authuser.dropbox) { return res.redirect('/dropbox'); }
    
    if ( ! req.body.package) { return res.status(400).render(400, { error: 'Exercise package required' }); }
    if ( ! req.body.main) { return res.status(400).render(400, { error: 'Exercise main class required' }); }
    if ( ! req.body.title) { return res.status(400).render(400, { error: 'Exercise title required' }); }
    workspace.dropbox(authuser, function(err, drop) {
      drop.findJavaFiles(req.params[0], function(err, folder, files) {
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
          if (err) { return res.status(500).render(500); }
          res.redirect('/');
        });
      });
    });
  });
});

app.get('/ex/:exercise', function(req, res) {
  workspace.findExercise(req.params.exercise, function(err, exercise) {
    if (err) { return res.status(500).render(500); }
    if ( ! exercise) { return res.status(404).render(404, { what: 'exercise' }); }
    res.render('exercise', {
      exercise: exercise
    });
  });
});

app.get('/pair/:exercise', function(req, res) {
  workspace.findExercise(req.params.exercise, function(err, exercise) {
    if (err) { return res.status(500).render(500); }
    if ( ! exercise) { return res.status(404).render(404, { what: 'exercise' }); }
    res.render('join', {
      exercise: exercise,
      joincode: join.code(req.params.exercise)
    });
  });
});

app.post('/pair/:exercise', function(req, res) {
  join.rendezvous(req.params.exercise, req.body.me, req.body.partner, function(err, objID) {
    if (err) { return res.send(400, { error: err.message }); }
    workspace.joinProject(objID, req.params.exercise, res.locals.authusername, function(err, project) {
      if (err) { console.error('Error joining project', err); }
      res.send({ redirect: '/' + project._id });
    });
  });
});

app.get('/:project', function(req, res) {
  workspace.findProject(req.params.project, function(err, project) {
    if (err) { return res.send(500).render(500); }
    if ( ! project) { return res.status(404).render(404, { what: 'project '}); }
    if (project.users.indexOf(res.locals.authusername) < 0) { return res.render(401); }
    
    res.render('project', {
      shareURL: req.protocol + '://' + req.host + ':' + config.web.share,
      project: project
    });
  });
});

app.post('/:project/save', function(req, res) {
  workspace.saveProject(req.params.project, function(err, project, files) {
    if (err) { return res.send(500, { error: 'Error saving project' }); }
    java.compileAndRun(files, project.exercise.package, project.exercise.main, function(err, result) {
      if (err) { return res.send(500, { error: 'Error running project' }); }
      res.send(200, result);
    });
  });
});

var shareapp = express();
workspace.attach(shareapp);
var share = https.createServer({
  key: fs.readFileSync('./config/ssl-private-key.pem'),
  cert: fs.readFileSync('./config/ssl-certificate.pem'),
  ca: [ fs.readFileSync('./config/ssl-ca.pem') ],
}, shareapp);
share.listen(config.web.share, function() {
  console.log('ShareJS listening on', share.address());
});

var server = https.createServer({
  key: fs.readFileSync('./config/ssl-private-key.pem'),
  cert: fs.readFileSync('./config/ssl-certificate.pem'),
  ca: [ fs.readFileSync('./config/ssl-ca.pem') ],
  requestCert: true
}, app);
server.listen(config.web.https, function() {
  console.log('Express listening on', server.address());
});

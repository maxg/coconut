var byline = require('byline');
var events = require('events');
var fs = require('fs');
var spawn = require('child_process').spawn;
var temp = require('temp');

exports.compileAndRun = function(files, package, main, callback) {
  if (package.length > 0 && package.substr(-1) != '.') {
    package = package + '.';
  }
  var sources = {};
  files.forEach(function(file) {
    sources[package + file.filename.replace(/\.java$/, '')] = file.data;
  });
  
  javac(sources).once('done', function(err, compile, zip) {
    if (err) { return callback(err); }
    if (compile.destination != zip) {
      return callback(new Error('Compilation queue error'));
    }
    java(zip, package + main.replace(/\.java$/, '')).once('done', function(err, run) {
      if (err) { return callback(err); }
      callback(null, { compile: compile, run: run });
      setTimeout(function() { fs.unlinkSync(zip); }, 60000);
    });
  });
};

function nice() {
  var child = spawn('nice', Array.prototype.slice.call(arguments));
  var sigterm = setTimeout(function() { child.emit('timeout'); child.kill(); }, 2000);
  var sigkill = setTimeout(function() { child.kill('SIGKILL'); }, 3000);
  child.on('exit', function() {
    clearTimeout(sigterm);
    clearTimeout(sigkill);
  });
  return child;
}

const compiler = spawn('java', [ '-cp', 'bin', 'coconut.Compile' ]);
const queue = [];

function javac(sources) {
  var emitter = new events.EventEmitter();
  
  temp.open({ suffix: '.zip' }, function(err, info) {
    if (err) {
      console.error('Temporary file error', err);
      return emitter.emit('done', err);
    }
    
    var zip = info.path;
    queue.push({
      emitter: emitter,
      zip: zip,
    });
    compiler.stdin.write(JSON.stringify({
      destination: zip,
      sources: sources,
    }) + '\n', 'utf8');
    
    fs.close(info.fd, function() { });
  });
  
  return emitter;
}

compiler.stderr.pipe(process.stderr);
compiler.stdout.setEncoding('utf8');
byline(compiler.stdout).on('data', function(out) {
  var req = queue.shift();
  try {
    req.emitter.emit('done', null, JSON.parse(out), req.zip);
  } catch (err) {
    console.error('Error compiling Java', out);
    emitter.emit('done', err);
  }
});

function java(zip, main) {
  var emitter = new events.EventEmitter();
  
  var child = nice('java', '-Djava.security.manager', '-cp', zip, main);
  
  var out = [];
  var stdout = function(data) { out.append({ $: data }); };
  var stderr = function(data) { out.append({ $: data, err: true }); };
  Object.defineProperty(out, 'append', { value: function(line) {
    this.push(line);
    if (this.length > 512) {
      child.kill();
      this.push({ truncated: true });
      child.stdout.removeListener('data', stdout);
      child.stderr.removeListener('data', stderr);
    }
  } });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', stdout);
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', stderr);
  
  child.once('timeout', function() { out.push({ timeout: true }); });
  child.once('close', function() { emitter.emit('done', null, out); });
  
  return emitter;
}

if (require.main === module) {
  var compile = javac(require('./' + process.argv[2]));
  compile.once('done', function(err, out, zip) {
    console.log('--compile--\n', out);
    var run = java(zip, 'Main');
    run.on('done', function(err, out) {
      console.log('--run--\n', out);
      fs.unlinkSync(zip);
    });
  });
}

var events = require('events');
var fs = require('fs');
var mongodb = require('mongodb');

var display = fs.readFileSync('./config/words.txt', { encoding: 'utf8' }).trim().split('\n');
var dictionary = display.map(function(word) { return word.toLowerCase(); });

function randomWords(count) {
  var words = [];
  while (count-- > 0) { words.push(display[Math.floor(Math.random() * display.length)]); }
  return words;
}

var active = {};

exports.code = function(exerciseID) {
  var count = 1;
  var iters = 0;
  do {
    if (iters++ > 10) { count += 1 };
    var words = randomWords(count);
  } while (Object.hasOwnProperty.call(active, words));
  active[words] = active[canonical(words)] = exerciseID;
  setTimeout(function() {
    delete active[words];
    delete active[canonical(words)];
  }, 1000 * 60 * 60);
  return words;
};

function canonical(words) {
  return words.map(function(word) { return dictionary.indexOf(word.toLowerCase()); });
}

function display(indices) {
  return indices.map(function(idx) { return display[idx]; });
}

var joins = new events.EventEmitter();

exports.rendezvous = function(exerciseID, me, partner, callback/*(err, objID)*/) {
  if (me.constructor !== Array) { return callback(new Error('Invalid self joincode')); }
  if (partner.constructor !== Array) { return callback(new Error('Invalid partner joincode')); }
  
  me = canonical(me);
  partner = canonical(partner);
  
  if (me.indexOf(-1) >= 0) { return callback(new Error('Unknown self joincode')); }
  if (partner.indexOf(-1) >= 0) { return callback(new Error('Unknown partner joincode')); }
  if (me.toString() == partner) { return callback(new Error("Enter your partner's joincode")); }
  
  if (active[me] != active[partner]) { return callback(new Error('Different exercises selected')); }
  
  function join(id) {
    callback(null, id);
    callback = null;
  }
  var id = new mongodb.ObjectID();
  if (joins.emit(exerciseID + '~' + me + '~' + partner, id)) {
    join(id);
  } else {
    joins.once(exerciseID + '~' + partner + '~' + me, join);
    setTimeout(function() {
      joins.removeListener(partner + '~' + me, join);
      if (callback) { callback(new Error('Timed out')); }
    }, 1000 * 60 * 5);
  }
};

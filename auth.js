var oauth = require('oauth');

var config = require('./config');

exports.dropbox = new oauth.OAuth2(
  config.dropbox.key,
  config.dropbox.secret,
  '',
  'https://www.dropbox.com/1/oauth2/authorize',
  'https://api.dropbox.com/1/oauth2/token'
);
exports.dropbox.getAuthorizeUrl = function() {
  var url = oauth.OAuth2.prototype.getAuthorizeUrl.apply(exports.dropbox, arguments);
  return url.replace('type=web_server', 'response_type=code');
};
exports.dropbox._request = function() {
  arguments[3] = arguments[3].replace('type=web_server', 'grant_type=authorization_code');
  return oauth.OAuth2.prototype._request.apply(exports.dropbox, arguments);
};

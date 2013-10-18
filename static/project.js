var editors = {};
var documents = {};

function editorSetup(div, filename) {
  var editor = ace.edit(div);
  editors[filename] = editor;
  
  editor.setTheme('ace/theme/eclipse');
  editor.getSession().setMode('ace/mode/java');
  editor.commands.addCommand({
    name: 'Save',
    bindKey: {win: 'Ctrl-S',  mac: 'Command-S'},
    exec: editorSave
  });
  
  sharejs.open(project + '~' + filename, 'text', shareURL + '/channel', function(err, doc) {
    documents[filename] = doc;
    doc.attach_ace(editor);
    setTimeout(function() { editor.selection.moveCursorFileStart(); }, 0);
  });
}

function editorJump(filename, line, column) {
  $('#editor a[data-file="' + filename + '"]').tab('show');
  editors[filename].moveCursorTo(line-1, column-1);
}

function editorSave() {
  $('#building').css('display', 'inline-block');
  $('#build-error').hide();
  $.post(document.location.pathname + '/save').done(function(result) {
    $('#output').html(jade.render('project-output', result));
  }).fail(function(result) {
    $('#build-error').css('display', 'inline-block');
    $('#build-error-text').text(result.responseJSON.error || 'Unknown error');
    console && console.error && console.error(arguments);
  }).always(function() {
    $('#building').hide();
  });
}

$(document).ready(function() {
  
  $('#output').html(jade.render('project-output', { compile: {}, run: {} }));
  
  var chromeHeight = $('.navbar-fixed-top').outerHeight(true) +
                     $('.navbar-fixed-bottom').outerHeight(true) +
                     $('#editor .nav-tabs').outerHeight(true) +
                     $('#output').outerHeight(true);
  function fitEditors() {
    $('.editor').height($(window).innerHeight() - chromeHeight);
  }
  $(window).resize(fitEditors);
  fitEditors();
  
  $('.editor').each(function(index, div) {
    editorSetup(div, div.getAttribute('data-file'));
  });
  
  $('#output').on('click', '#save', function() {
    editorSave();
    return false;
  });
  
  $('#output').on('click', '.editor-jump', function() {
    editorJump(this.getAttribute('data-editor-file'), this.getAttribute('data-editor-line'), this.getAttribute('data-editor-column'));
    return false;
  });
});

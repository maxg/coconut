var editors = {};

function editorSetup(div, filename) {
  var editor = ace.edit(div);
  editors[filename] = editor;
  
  editor.setTheme('ace/theme/eclipse');
  editor.getSession().setMode('ace/mode/java');
  editor.commands.addCommand({
    name: 'Save',
    bindKey: { win: 'Ctrl-S',  mac: 'Command-S' },
    exec: editorSave
  });
  
  attachEditorDocument(editor, filename);
}

function attachEditorDocument(editor, filename) {
  sharejs.open(project + '~' + filename, 'text', shareURL + '/channel', function(err, doc) {
    editor.once('change', function() {
      setTimeout(function() { editor.selection.moveCursorFileStart(); }, 0);
    });
    doc.attach_ace(editor);
    var listeners = editor.getSession().getDocument()._eventRegistry.change;
    listeners.push(scrollFix(listeners.pop())); // ShareJS listener was added last
  });
  
  function scrollFix(editorListener) {
    function countLines(delta) {
      switch (delta.action) {
      case 'insertText': return (delta.text.match(/\n/g) || []).length;
      case 'removeText': return - (delta.text.match(/\n/g) || []).length;
      case 'insertLines': return delta.lines.length;
      case 'removeLines': return - delta.lines.length;
      }
      return 0;
    }
    
    return function(change) {
      var oldTop = editor.getSession().getScrollTop();
      var result = editorListener.call(this, change);
      if (result !== undefined) {
        return; // editorListener returns a timer handle from check() only for local edits
      }
      if (change.data.range.start.row >= editor.getCursorPosition().row) {
        return; // change is below the cursor
      }
      var lines = countLines(change.data);
      if (lines == 0) {
        return; // change did not add or remove lines
      }
      // correct scroll position for change that added/removed lines above us
      editor.getSession().setScrollTop(oldTop + editor.renderer.$cursorLayer.config.lineHeight * lines);
    };
  }
}

function editorJump(filename, line, column) {
  $('#editor a[data-file="' + filename + '"]').tab('show');
  var editor = editors[filename];
  editor.focus();
  editor.clearSelection();
  editor.moveCursorTo(line-1, column-1);
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

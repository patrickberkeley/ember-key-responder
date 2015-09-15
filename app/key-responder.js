import Ember from 'ember';

const { get, computed, isNone } = Ember;

/*
  Holds a stack of key responder views. With this we can neatly handle
  restoring the previous key responder when some modal UI element is closed.
  There are a few simple rules that governs the usage of the stack:
   - mouse click does .replace (this should also be used for programmatically taking focus when not a modal element)
   - opening a modal UI element does .push
   - closing a modal element does .pop

  Also noteworthy is that a view will be signaled that it loses the key focus
  only when it's popped off the stack, not when something is pushed on top. The
  idea is that when a modal UI element is opened, we know that the previously
  focused view will re-gain the focus as soon as the modal element is closed.
  So if the previously focused view was e.g. in the middle of some edit
  operation, it shouldn't cancel that operation.
*/
var KeyResponder = Ember.Object.extend({
  init: function() {
    this.set('isActive', true);
    this.set('stack', Ember.A());
    this._super.apply(this, arguments);
  },

  current: computed.readOnly('stack.lastObject'),
  pushView: function(view, wasTriggeredByFocus) {
    if (!isNone(view)) {
      view.trigger('willBecomeKeyResponder', wasTriggeredByFocus);
      const stack = get(this, 'stack');
      stack.pushObject(view);
      view.trigger('didBecomeKeyResponder', wasTriggeredByFocus);
    }
    return view;
  },

  resume: function() {
    this.set('isActive', true);
  },

  pause: function() {
    this.set('isActive', false);
  },

  popView: function(wasTriggeredByFocus) {
    const stack = get(this, 'stack');
    if (get(this, 'stack.length') > 0) {
      var view = get(this, 'current');
      if (view) {
        view.trigger('willLoseKeyResponder', wasTriggeredByFocus);
      }
      view = stack.popObject();
      if (view) {
        view.trigger('didLoseKeyResponder', wasTriggeredByFocus);
      }
      return view;
    } else {
      return undefined;
    }
  },

  replaceView: function(view, wasTriggeredByFocus) {
    if (get(this, 'current') !== view) {
      this.popView(wasTriggeredByFocus);
      return this.pushView(view, wasTriggeredByFocus);
    }
  }
});

export default KeyResponder;

export var KEY_EVENTS = {
  8: 'deleteBackward',
  9: 'insertTab',
  13: 'insertNewline',
  27: 'cancel',
  32: 'insertSpace',
  37: 'moveLeft',
  38: 'moveUp',
  39: 'moveRight',
  40: 'moveDown',
  46: 'deleteForward'
};

export var MODIFIED_KEY_EVENTS = {
  8: 'deleteForward',
  9: 'insertBacktab',
  37: 'moveLeftAndModifySelection',
  38: 'moveUpAndModifySelection',
  39: 'moveRightAndModifySelection',
  40: 'moveDownAndModifySelection'
};

var KeyResponderSupportViewMixin = Ember.Mixin.create({
  // Set to true in your view if you want to accept key responder status (which
  // is needed for handling key events)
  acceptsKeyResponder: false,
  canBecomeKeyResponder: computed('acceptsKeyResponder',
                                        'disabled',
                                        'isVisible', function() {
    return get(this, 'acceptsKeyResponder') &&
          !get(this, 'disabled') &&
           get(this, 'isVisible');
  }).readOnly(),

  becomeKeyResponderViaMouseDown: Ember.on('mouseDown',function(evt) {
    var responder = this.get('keyResponder');
    if (responder === undefined) { return; }

    Ember.run.later(function() {
      responder._inEventBubblingPhase = undefined;
    }, 0);

    if (responder._inEventBubblingPhase === undefined) {
      responder._inEventBubblingPhase = true;
      this.becomeKeyResponder(false);
    }
  }),

  /*
    Sets this view as the target of key events. Call this if you need to make
    this happen programmatically.  This gets also called on mouseDown if the
    view handles that, returns true and doesn't have property
    'acceptsKeyResponder'
    set to false. If mouseDown returned true but 'acceptsKeyResponder' is
    false, this call is propagated to the parent view.

    If called with no parameters or with replace = true, the current key
    responder is first popped off the stack and this view is then pushed. See
    comments for Ember.KeyResponderStack above for more insight.
  */
  becomeKeyResponder: function(replace, wasTriggeredByFocus) {
    if (wasTriggeredByFocus === undefined) {
      wasTriggeredByFocus = false;
    }

    var keyResponder = get(this, 'keyResponder');

    if (!keyResponder) {
      return;
    }

    if (get(keyResponder, 'current') === this) {
      return;
    }

    if (get(this, 'canBecomeKeyResponder')) {
      if (replace === undefined || replace === true) {
        return keyResponder.replaceView(this, wasTriggeredByFocus);
      } else {
        return keyResponder.pushView(this, wasTriggeredByFocus);
      }
    } else {
      var parent = get(this, 'parentView');

      if (parent && parent.becomeKeyResponder) {
        return parent.becomeKeyResponder(replace, wasTriggeredByFocus);
      }
    }
  },

  becomeKeyResponderViaFocus: function() {
    return this.becomeKeyResponder(true, true);
  },

  /*
    Resign key responder status by popping the head off the stack. The head
    might or might not be this view, depending on whether user clicked anything
    since this view became the key responder. The new key responder
    will be the next view in the stack, if any.
  */
  resignKeyResponder: function(wasTriggeredByFocus) {
    if (wasTriggeredByFocus === undefined) {
      wasTriggeredByFocus = false;
    }

    var keyResponder = get(this, 'keyResponder');

    if (!keyResponder) {
      return;
    }

    keyResponder.popView(wasTriggeredByFocus);
  },

  resignKeyResponderViaFocus: function() {
    return this.resignKeyResponder(true);
  },

  respondToKeyEvent: function(event) {
    Ember.run(this, function() {
      if (get(this, 'keyResponder.isActive')) {
        if (get(this, 'keyResponder.current.canBecomeKeyResponder')) {
          get(this, 'keyResponder.current').interpretKeyEvents(event);
        }
      }
    });
  },

  interpretKeyEvents: function(event) {
    var mapping = event.shiftKey ? MODIFIED_KEY_EVENTS : KEY_EVENTS;
    var eventName = mapping[event.keyCode];

    if (eventName && this.has(eventName)) {
      return this.trigger(eventName, event);
    }

    return false;
  }
});

Ember.View.reopen(KeyResponderSupportViewMixin);
Ember.Component.reopen(KeyResponderSupportViewMixin);

export var KeyResponderInputSupport = Ember.Mixin.create({
  acceptsKeyResponder: true,
  init: function () {
    this._super.apply(this, arguments);
    this.on('focusIn', this, this.becomeKeyResponderViaFocus);
    this.on('focusOut', this, this.resignKeyResponderViaBlur);
  },

  didBecomeKeyResponder: function(wasTriggeredByFocus){
    if (!wasTriggeredByFocus && this._state === 'inDOM') {
      this.$().focus();
    }
  },

  didLoseKeyResponder: function(wasTriggeredByFocus){
    if (!wasTriggeredByFocus && this._state === 'inDOM') {
      this.$().blur();
    }
  }
});

Ember.TextSupport.reopen(KeyResponderInputSupport);
Ember.Checkbox.reopen(KeyResponderInputSupport);
Ember.Select.reopen(KeyResponderInputSupport);

'use strict';


var Assert = require('assert');
var Hash = require('../lib/types/hash');


require('vows').describe('Hash').addBatch({
  'With defaultValue given to the constructor': {
    topic: new Hash('default'),
    'it is returned when key not found': function (h) {
      Assert.equal(h.retrieve('foo'), 'default');
    }
  },

  'Without defaultValue': {
    topic: new Hash(),
    'undefined returned on key that does not exists': function (h) {
      Assert.isUndefined(h.retrieve('foo'));
    }
  },

  'With non-scalar keys': {
    topic: new Hash('none'),

    'arrays are not stringified (joined)': function (h) {
      var k = [1,2,3];
      h.store(k, 123);

      Assert.equal(h.retrieve(k), 123);
      Assert.equal(h.retrieve('1,2,3'), 'none');
      Assert.equal(h.retrieve([1,2,3]), 'none');
    },

    'object are not stringified or ompared by values': function (h) {
      var k = {foo: 'bar'};
      h.store(k, 123);

      Assert.equal(h.retrieve(k), 123);
      Assert.equal(h.retrieve('[object Object]'), 'none');
      Assert.equal(h.retrieve({foo: 'bar'}), 'none');
    },

    'scalars are not stringified, thus type-sensitive': function (h) {
      h.store(1, 123);
      h.store('1', 'abc');

      Assert.equal(h.retrieve(1), 123);
      Assert.equal(h.retrieve('1'), 'abc');
    }
  },

  'Hash without values': {
    topic: new Hash(),
    'is empty': function (h) {
      Assert.ok(h.isEmpty());
    },
    'contains 0 elements': function (h) {
      Assert.equal(h.count, 0);
    }
  },

  'When adding/removing keys': {
    topic: new Hash(),
    'count of elements is raised when new pair is added': function (h) {
      var count = h.count;

      h.store('foo', 'bar');
      Assert.equal(h.count, count + 1);
    },

    'count of elements is lowered when key is removed': function (h) {
      var count;

      h.store('foo', 'bar');
      count = h.count;

      h.remove('foo');
      Assert.equal(h.count, count - 1);
    }
  },

  'When key exists': {
    topic: new Hash(),
    'we can check hasKey': function (h) {
      h.store(1, 123);

      Assert.ok(h.hasKey(1));
      Assert.ok(!h.hasKey(2));
    }
  },


  'when defaultValue is function': {
    topic: new Hash(function (h, k) { return h.set(k, []); }),

    'it is called for unknown keys': function (h) {
      Assert.isArray(h.get('foo'));
      Assert.ok(h.hasKey('foo'));
    }
  }
}).export(module);

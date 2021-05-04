'use strict';


var Assert      = require('assert');
var SortedList  = require('../lib/types/sorted_list');


require('vows').describe('SortedList').addBatch({
  'Adding weights': {
    topic: function () {
      var s = new SortedList();

      s.add(-10, '-10');
      s.add(-20, '-20');
      s.add(-30, '-30');
      s.add(30,  '+30');
      s.add(20,  '+20');
      s.add(10,  '+10');

      return s;
    },

    'weights are respected on sorting': function (s) {
      Assert.equal(s.sorted.join(','), '-30,-20,-10,+10,+20,+30');
    },

    'with same width': {
      topic: function (s) {
        s.add(0, '.');
        s.add(0, 'o');
        s.add(0, '@');

        return s;
      },

      'values are sorted in order of appearance': function (s) {
        Assert.equal(s.sorted.join(','), '-30,-20,-10,.,o,@,+10,+20,+30');
      }
    }
  },

  'Concatenation': {
    topic: function () {
      var a = new SortedList(), b = new SortedList, c;

      a.add(-10, '-10');
      a.add(-20, '-20');
      a.add(-30, '-30');

      b.add(30,  '+30');
      b.add(20,  '+20');
      b.add(10,  '+10');

      c = a.concat(b);

      return [a, b, c];
    },

    'produces new list': function (lists) {
      Assert.ok(lists[0] !== lists[2]);
      Assert.ok(lists[1] !== lists[2]);
    },

    'produces list with elements from original lists': function (lists) {
      Assert.equal(lists[0].sorted.join(','), '-30,-20,-10');
      Assert.equal(lists[1].sorted.join(','), '+10,+20,+30');
      Assert.equal(lists[2].sorted.join(','), '-30,-20,-10,+10,+20,+30');
    }
  }
}).export(module);

/**
 *  class SortedList
 *
 *  Provides easy way to build sequences of objects (or functions) based on
 *  priority weight.
 *
 *  ##### Example
 *
 *      var set = new SortedList();
 *
 *      set.add(20, 'World!').add(10, 'Hello');
 *      set.sorted.join(' ');
 *      // -> Hello World!
 *
 *      set.add(10, ', Cruel');
 *      set.sorted.join(' ');
 *      // -> Hello, Cruel World!
 **/


'use strict';


// callback for Array#sort to sort numbers adequately :))
function sort_nums_asc(a, b) {
  return a - b;
}


// returns sequence array for given weight
function get_sequence(self, weight) {
  if (undefined === self.__sequences__[weight]) {
    self.__sequences__[weight] = [];
  }

  return self.__sequences__[weight];
}


/**
 *  new SortedList()
 **/
var SortedList = module.exports = function SortedList() {
  this.__sequences__ = {};
  this.__sorted__ = null;
};


/** chainable
 *  SortedList#add(weight, val) -> SortedList
 *  - weight (Number): Weight of value
 *  - val (Mixed): Any value
 *
 *  Appends `val` into the set with given `weight`.
 **/
SortedList.prototype.add = function add(weight, val) {
  this.__sorted__ = null;
  get_sequence(this, +weight).push(val);
  return this;
};


/**
 *  SortedList#sorted -> Array
 *
 *  Returns array of all values sorted according to their weights
 *
 *  ##### Example
 *
 *      set.add(20, 'b').add(30, 'c').add(10, 'a');
 *      set.flatten().join('');
 *      // -> abc
 **/
SortedList.prototype.__defineGetter__('sorted', function sorted() {
  var arr = [], self = this;

  if (null !== this.__sorted__) {
    return this.__sorted__;
  }

  function iterator(weight) {
    get_sequence(self, weight).forEach(function (val) {
      arr.push(val);
    });
  }

  Object.getOwnPropertyNames(this.__sequences__)
    .sort(sort_nums_asc)
    .forEach(iterator);

  this.__sorted__ = arr;
  return arr;
});


/**
 *  SortedList#concat(other) -> SortedList
 *
 *  Returns new SortedList containing elements from both original and other
 *  lists.
 **/
SortedList.prototype.concat = function concat(other) {
  var result = SortedList.create(), store = result.__sequences__;

  [this, other].forEach(function (set) {
    Object.getOwnPropertyNames(set.__sequences__).forEach(function (prio) {
      store[prio] = (store[prio] || []).concat(set.__sequences__[prio]);
    });
  });

  return result;
};


/** alias: SortedList.new
 *  SortedList.create() -> SortedList
 *
 *  Constructor proxy.
 **/
SortedList.create = function create() {
  return new SortedList();
};

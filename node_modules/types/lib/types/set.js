/**
 *  class Set
 *
 *  Provides Array that contains only unique elements.
 *
 *  ##### Example
 *
 *      var set = new Set();
 *
 *      set.push('Hello').push('World!').push('Hello');
 *      set.join(' ');
 *      // -> Hello World!
 **/


'use strict';


/**
 *  new Set(arr)
 *  - arr (Array): Initial array to fill-in
 *
 *  Creates new instance of Set.
 *
 *      var s = new Set([1, 2, 1, 3]);
 *      s.toArray();
 *      // -> [1, 2, 3]
 **/
function Set(arr) {
  Object.defineProperty(this, '__arr__', {value: []});

  if (arr) {
    arr.forEach(function (el) { this.push(el); }, this);
  }
}


/**
 *  Set#unshift(val) -> Void
 *  - val (Mixed)
 *
 *  Prepends `val` to the head of the set.
 *  See native `Array#unshift` function for details.
 **/
Set.prototype.unshift = function (val) {
  if (-1 === this.__arr__.indexOf(val)) {
    this.__arr__.unshift(val);
  }
};


/**
 *  Set#push(val) -> Void
 *  - val (Mixed)
 *
 *  Appends `val` to the tail of the set.
 *  See native `Array#push` function for details.
 **/
Set.prototype.push = function (val) {
  if (-1 === this.__arr__.indexOf(val)) {
    this.__arr__.push(val);
  }
};


/**
 *  Set#forEach(iterator[, thisArg]) -> Void
 *  - iterator (Function)
 *  - thisArg (Object)
 *
 *  Proxy to `forEach` of internal array.
 *  See native `Array#forEach` function for details.
 **/


/**
 *  Set#slice(begin[, end]) -> Void
 *
 *  Returns a one-level deep copy of a portion of a set.
 *  See native `Array#slice` function for details.
 **/


/**
 *  Set#join(separator) -> Void
 *
 *  Joins all elements of a set into a string.
 *  See native `Array#join` function for details.
 **/


/**
 *  Set#shift() -> Mixed
 *
 *  Removes the first element from a set and returns that element.
 *  See native `Array#shift` function for details.
 **/


/**
 *  Set#pop() -> Mixed
 *
 *  Removes the last element from a set and returns that element.
 *  See native `Array#pop` function for details.
 **/


['forEach', 'slice', 'join', 'shift', 'pop'].forEach(function (name) {
  Set.prototype[name] = function () {
    return this.__arr__[name].apply(this.__arr__, arguments);
  };
});


/**
 *  Set#length -> Numeric
 *
 *  Reflects the number of elements in a set.
 **/
Object.defineProperty(Set.prototype, 'length', {
  get: function () { return this.__arr__.length; }
});


/**
 *  Set#toArray() -> Array
 *
 *  Syntax sugar. Same as calling `set.slice()`.
 **/
Set.prototype.toArray = function () {
  return this.slice();
};


////////////////////////////////////////////////////////////////////////////////


module.exports = Set;

if (!Array.prototype.remove) {
  Array.prototype.remove = function (item, ignore_error = false) {
    let i = this.indexOf(item);

    if (i < 0) {
      if (ignore_error) {
        console.warn("Item", item, "is not in array.");
        return;
      } else {
        console.error("Item", item, "is not in array.");
        throw new Error("Item " + item + " is not in array.");
      }
    }

    while (i < this.length - 1) {
      this[i] = this[i + 1];
      i++;
    }

    this[i] = undefined;
    this.length--;
  };
}


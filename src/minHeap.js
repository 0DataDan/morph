export class MinHeap {
    constructor() {
        this.data = [];
    }

    get size() {
        return this.data.length;
    }

    push(node) {
        this.data.push(node);
        this._bubbleUp(this.data.length - 1);
    }

    pop() {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this._sinkDown(0);
        }
        return top;
    }

    _bubbleUp(i) {
        const node = this.data[i];
        while (i > 0) {
            const parentIdx = (i - 1) >> 1;
            const parent = this.data[parentIdx];
            if (node.f >= parent.f) break;
            this.data[i] = parent;
            i = parentIdx;
        }
        this.data[i] = node;
    }

    _sinkDown(i) {
        const len = this.data.length;
        const node = this.data[i];
        while (true) {
            const left = (i << 1) + 1;
            const right = left + 1;
            let smallest = i;
            if (left < len && this.data[left].f < this.data[smallest].f) smallest = left;
            if (right < len && this.data[right].f < this.data[smallest].f) smallest = right;
            if (smallest === i) break;
            this.data[i] = this.data[smallest];
            i = smallest;
        }
        this.data[i] = node;
    }
}
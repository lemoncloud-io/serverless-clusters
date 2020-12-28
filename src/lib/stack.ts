/**
 * `stack.ts`
 *
 * origin refer to `https://dev.to/macmacky/implement-a-stack-with-typescript-4e09`
 *
 * @author      Steve Jung <steve@lemoncloud.io>
 * @date        2020-12-22 initial version, and optimized.
 *
 * @copyright (C) 2020 LemonCloud Co Ltd. - All Rights Reserved.
 */

/**
 * node in stack
 */
export interface StackNode<T> {
    value: T | null;
    next: StackNode<T> | null;
}

/**
 * class: `StackNode`
 */
export class StackNode<T> implements StackNode<T> {
    public constructor(val: T) {
        this.value = val;
        this.next = null;
    }
}

/**
 * spec for stack.
 */
export interface Stack<T> {
    size: number;
    top: StackNode<T> | null;
    bottom: StackNode<T> | null;
    /**
     * push into stack
     * @param val element.
     */
    push(val: T): number;
    /**
     * pop the top from stack (as LIFO)
     */
    pop(): T | null;
    /**
     * pull from bottom (as FIFO)
     */
    pull(): T | null;
}

/**
 * class: `Stack`
 */
export class Stack<T = string> implements Stack<T> {
    public constructor() {
        this.size = 0;
        this.top = null;
        this.bottom = null;
    }

    public push = (val: T) => {
        const node = new StackNode(val);
        if (this.size === 0) {
            this.top = node;
            this.bottom = node;
        } else {
            const currentTop = this.top;
            this.top = node;
            this.top.next = currentTop;
        }

        this.size += 1;
        return this.size;
    };

    public pop = (): T | null => {
        if (this.size > 0) {
            const nodeToBeRemove = this.top as StackNode<T>;
            this.top = nodeToBeRemove.next;
            this.size -= 1;
            nodeToBeRemove.next = null;
            return nodeToBeRemove?.value;
        }
        return null;
    };

    public pull = (): T | null => {
        if (this.size > 0) {
            const nodeToBeRemove = this.bottom as StackNode<T>;
            let $parent = this.top as StackNode<T>;
            for (;;) {
                if (!$parent.next || $parent.next === nodeToBeRemove) break; // if have only 1. then `.next` could be null.
                $parent = $parent.next;
            }
            this.bottom = $parent;
            this.size -= 1;
            $parent.next = null;
            return nodeToBeRemove?.value;
        }
        return null;
    };
}

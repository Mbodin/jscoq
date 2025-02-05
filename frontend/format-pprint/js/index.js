//@ts-check
"use strict";
import $ from 'jquery';

/**
 * @typedef { import('../../../backend').Pp } Pp
 */

/**
 * Render the pretty-print box output generated by OCaml's Format module
 * (https://caml.inria.fr/pub/docs/manual-ocaml/libref/Format.html)
 */
export class FormatPrettyPrint {

    /**
     * Formats a pretty-printed element to be displayed in an HTML document.
     * @param {Pp} pp a serialized Pp element
     * @param {'vertical'|'horizontal'} [topBox] wrap with a box ('vertical' / 'horizontal')
     */
    pp2DOM(pp, topBox) {
        if (!Array.isArray(pp)) {
            throw new Error("malformed Pp element: " + pp);
        }

        if (topBox) {
            var dom = this.pp2DOM(pp);
            return (dom.length == 1 && dom.is('.Pp_box')) ? dom :
                this.makeBox(dom, topBox);
        }

        // switch(tag) is too weak for TS typing
        switch (pp[0]) {

        // ["Pp_glue", [...elements]]
        case "Pp_glue":
            return pp[1].map(x => this.pp2DOM(x)).reduce((a, b) => a.add(b), $([]));

        // ["Pp_string", string]
        case "Pp_string":
            return $(document.createTextNode(pp[1]));

        // ["Pp_box", ["Pp_vbox"/"Pp_hvbox"/"Pp_hovbox", _], content]
        case "Pp_box":
            let [bty, offset] = pp[1],
                mode = (bty == 'Pp_vbox') ? 'vertical' : 'horizontal';
            return this.makeBox(this.pp2DOM(pp[2]), mode, bty, offset);

        // ["Pp_tag", tag, content]
        case "Pp_tag":
            return this._wrapTrimmed(this.pp2DOM(pp[2]), $('<span>').addClass(pp[1]));

        // ["Pp_force_newline"]
        case "Pp_force_newline":
            return $('<br/>').addClass('Pp_force_newline');

        // ["Pp_print_break", nspaces, indent-offset]
        case "Pp_print_break":
            var [nspaces, indent] = pp.slice(1);
            // notice that `n` may be negative (#263) -- not sure how to handle this case
            var spn = (n, c) => $('<span>').text(" ".repeat(Math.max(0, n))).addClass(c);
            return $('<span>').addClass('Pp_break').attr('data-args', [pp[1], pp[2]])
                .append(spn(nspaces, 'spaces'), $('<br/>'),
                        spn(0, 'prev-indent'), spn(indent, 'indent'));

        case "Pp_empty":
            return $([]);

        default:
            console.warn("unhandled Format case", pp[0]);
            return $([]);
        }
    }

    msg2DOM(msg) {
        return this.pp2DOM(msg, 'horizontal');
    }

    static _idToString(id) { // this is, unfortunately, duplicated from CoqManager :/
        /**/ console.assert(id[0] === 'Id') /**/
        return id[1];
    }

    makeBox(jdom, mode, bty, offset) {
        return $('<div>').addClass('Pp_box').append(jdom)
            .attr({'data-mode': mode, 'data-bty': bty, 'data-offset': offset});
    }

    /**
     * This attempts to mimic the behavior of `Format.print_break` in relation
     * to line breaks.
     * @param {JQuery<HTMLElement>} jdom a DOM subtree produced by `pp2DOM` or `goals2DOM`.
     */
    adjustBreaks(jdom) {
        var width = jdom.width() || 0,
            boxes = jdom.find('.Pp_box');

        /** @todo should probably reset the state of all breaks,
            in case `adjustBreaks` is called a second time e.g. after resize */

        function closest($el, p) {
            return [...$el.parents()].find(p);
        }
        function isBlockLike(el) {
            return BLOCK_LIKE.includes(window.getComputedStyle(el).display);
        }
        function contentLeft(el) { // get offset where content actually starts (after left padding)
            // using the `firstChild` cleverly skips the padding, but oh it assumes so much...
            return el.firstChild.offsetLeft;
        }

        function breakAt(brk, boxOffset = 0, boxOffsetLeft = 0) {
            var offsetText = " ".repeat(boxOffset);
            brk.addClass('br')
                .children('.prev-indent').text(offsetText)
                .css({marginLeft: boxOffsetLeft})
        }

        for (let el of boxes) {
            let box = $(el),
                mode = box.attr('data-mode') || 'horizontal',
                offset = +box.attr('data-offset') || 0,
                offsetLeft = box[0].offsetLeft - contentLeft(closest(box, isBlockLike)),
                brks = box.children('.Pp_break');
            if (mode == 'horizontal') {  /** @todo hov mode */
                var prev = null;
                for (let brk of brks) {
                    if (prev && $(brk).position().left >= width)
                        breakAt(prev, offset, offsetLeft);
                    prev = $(brk);
                }
                if (prev && box.position().left + box.width() > width)
                    breakAt(prev, offset, offsetLeft);
            }
            else /* vertical */ {
                for (let brk of brks) {
                    $(brk).children('.prev-indent').text('')
                        .css({marginLeft: offsetLeft})
                }
            }
        }

        jdom.toggleClass("text-only", this._isFlat(jdom));
    }

    _isFlat(jdom) {
        return jdom.find('.Pp_break').length == 0;
    }

    /**
     * Auxiliary method that wraps a node with an element, but excludes
     * leading and trailing spaces. These are attached outside the wrapper.
     *
     * So _wrapTrimmed(" ab", <span>) becomes " "<span>"ab"</span>.
     */
    _wrapTrimmed(jdom, wrapper_jdom) {
        if (jdom.length === 0) return wrapper_jdom;  // degenerate case

        var first = jdom[0], last = jdom[jdom.length - 1],
            lead, trail;

        if (first.nodeType === Node.TEXT_NODE) {
            lead = first.nodeValue.match(/^\s*/)[0];
            first.nodeValue = first.nodeValue.substring(lead.length);
        }

        if (last.nodeType === Node.TEXT_NODE) { // note: it can be the same node
            trail = last.nodeValue.match(/\s*$/);
            last.nodeValue = last.nodeValue.substring(0, trail.index);
            trail = trail[0];
        }

        return $([lead && document.createTextNode(lead),
                  wrapper_jdom.append(jdom)[0],
                  trail && document.createTextNode(trail)].filter(x => x));
    }

    pp2Text(msg, state) {

        // Elements are ...
        if (!Array.isArray(msg)) {
            return msg;
        }

        state = state || {breakMode: 'horizontal'};

        var ret;
        var tag, ct;
        [tag, ct] = msg;

        switch (tag) {

        // Element(tag_of_element, att (single string), list of xml)

        // ["Pp_glue", [...elements]]
        case "Pp_glue":
            let imm = ct.map(x => this.pp2Text(x, state));
            ret = "".concat(...imm);
            break;

        // ["Pp_string", string]
        case "Pp_string":
            if (state.breakMode === 'vertical' && ct.match(/^\ +$/)) {
                ret = "";
                state.margin = ct;
            }
            else
                ret = ct;
            break;

        // ["Pp_box", ["Pp_vbox"/"Pp_hvbox"/"Pp_hovbox", _], content]
        case "Pp_box":
            var vmode = state.breakMode,
                margin = state.margin ? state.margin.length : 0;

            state.margin = null;

            switch(msg[1][0]) {
            case "Pp_vbox":
                state.breakMode = 'vertical';
                break;
            default:
                state.breakMode = 'horizontal';
            }

            ret = this.pp2Text(msg[2], state);  /* TODO indent according to margin */
            state.breakMode = vmode;
            break;

        // ["Pp_tag", tag, content]
        case "Pp_tag":
            ret = this.pp2Text(msg[2], state);
            break;

        case "Pp_force_newline":
            ret = "\n";
            state.margin = null;
            break;

        // ["Pp_print_break", nspaces, indent-offset]
        case "Pp_print_break":
            ret = "";
            state.margin = null;
            if (state.breakMode === 'vertical'|| (msg[1] == 0 && msg[2] > 0 /* XXX need to count columns etc. */)) {
                ret = "\n";
            } else if (state.breakMode === 'horizontal') {
                ret = " ";
            } else if (state.breakMode === 'skip-vertical') {
                state.breakMode = 'vertical';
            }
            break;

        case "Pp_empty":
            ret = "";
            break;

        default:
            console.warn("unhandled Format case", msg);
            ret = msg;
        }
        return ret;
    }

}

const BLOCK_LIKE = ['block', 'inline-block', 'inline-flex', 'inline-table', 'inline-grid'];

// Local Variables:
// js-indent-level: 4
// End:

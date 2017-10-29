/**
 * Copyright (c) 2017 molio contributors, licensed under MIT, See LICENSE file for more info.
 *
 * @author David Sehnal <david.sehnal@gmail.com>
 */

import Column, { createAndFillArray } from '../../../../../mol-base/collections/column'
import { trimStr, Tokens } from '../tokenizer'
import { parseIntSkipLeadingWhitespace, parseFloatSkipLeadingWhitespace } from '../number-parser'

export default function FixedColumnProvider(lines: Tokens) {
    return function<T extends Column.Type>(offset: number, width: number, type: T) {
        return FixedColumn(lines, offset, width, type);
    }
}

export function FixedColumn<T extends Column.Type>(lines: Tokens, offset: number, width: number, type: T): Column<T['@type']> {
    const { data, indices, count: rowCount } = lines;
    const { kind } = type;

    const value: Column<T['@type']>['value'] = kind === 'str' ? row => {
        let s = indices[2 * row] + offset, le = indices[2 * row + 1];
        if (s >= le) return '';
        let e = s + width;
        if (e > le) e = le;
        return trimStr(data, s, e);
    } : kind === 'int' ? row => {
        const s = indices[2 * row] + offset;
        if (s > indices[2 * row + 1]) return 0;
        return parseIntSkipLeadingWhitespace(data, s, s + width);
    } : row => {
        const s = indices[2 * row] + offset;
        if (s > indices[2 * row + 1]) return 0;
        return parseFloatSkipLeadingWhitespace(data, s, s + width);
    };
    return {
        '@type': type,
        '@array': void 0,
        isDefined: true,
        rowCount,
        value,
        valueKind: row => Column.ValueKind.Present,
        toArray: params => createAndFillArray(rowCount, value, params),
        stringEquals: (row, v) => value(row) === v,
        areValuesEqual: (rowA, rowB) => value(rowA) === value(rowB)
    };
}
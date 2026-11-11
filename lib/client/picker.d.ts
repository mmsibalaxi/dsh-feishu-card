import type { PickerKind } from './picker-api.ts';
import { type PickerEntry } from './picker-api.ts';
export type { PickerKind } from './picker-api.ts';
export interface IdPickerProps {
    kind: PickerKind;
    /** Dialog title, e.g. 「添加允许的人」. */
    title: string;
    /** Placeholder for the search box. */
    placeholder: string;
    /** Shown when the list is empty. */
    emptyText: string;
    /** Ids already in the list, so a picked row can be marked instead of hidden. */
    selected?: readonly string[];
    onPick(entry: PickerEntry): void;
    onClose(): void;
}
export declare function IdPicker({ kind, title, placeholder, emptyText, selected, onPick, onClose, }: IdPickerProps): import("react").JSX.Element;

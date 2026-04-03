declare module '@toast-ui/editor' {
  export type EditorMode = 'markdown' | 'wysiwyg';

  export interface EditorOptions {
    el: HTMLElement;
    height?: string;
    initialEditType?: EditorMode;
    previewStyle?: 'vertical' | 'tab';
    usageStatistics?: boolean;
    hideModeSwitch?: boolean;
    placeholder?: string;
  }

  export class Editor {
    constructor(options: EditorOptions);
    on(eventType: 'change', handler: () => void): void;
    setMarkdown(markdown: string, cursorToEnd?: boolean): void;
    getMarkdown(): string;
    changeMode(mode: EditorMode, withoutFocus?: boolean): void;
    destroy(): void;
  }
}

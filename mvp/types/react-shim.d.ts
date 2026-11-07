/**
 * Compact React type shim.
 *
 * React 19 does not bundle its own TypeScript types, and the environment this
 * prototype was built in had no access to the npm registry, so `@types/react`
 * could not be installed. This file declares the subset of the React API the
 * app uses so that `tsc --noEmit` can still check application logic strictly.
 *
 * DOM attributes are intentionally loose (any attribute name is accepted);
 * event handlers, hooks, refs and component props are typed.
 *
 * To switch to the official types: `npm i -D @types/react @types/react-dom`,
 * delete this file, and fix whatever stricter DOM-prop errors surface.
 */

declare module 'react' {
  export type Key = string | number;

  export interface ReactElement<P = any> {
    type: any;
    props: P;
    key: string | null;
  }

  export type ReactNode =
    | ReactElement
    | string
    | number
    | bigint
    | boolean
    | null
    | undefined
    | Iterable<ReactNode>;

  export type FC<P = {}> = (props: P) => ReactNode;
  export type PropsWithChildren<P = unknown> = P & { children?: ReactNode };
  export type ComponentType<P = {}> = FC<P> | (new (props: P) => Component<P, any>);

  export type Dispatch<A> = (value: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);

  export interface RefObject<T> {
    current: T;
  }
  export type RefCallback<T> = (instance: T | null) => void | (() => void);
  export type Ref<T> = RefCallback<T> | RefObject<T | null> | null;

  export function useState<S>(initial: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useReducer<S, A>(reducer: (state: S, action: A) => S, initial: S): [S, Dispatch<A>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
  export function useRef<T>(initial: T): RefObject<T>;
  export function useRef<T>(initial: T | null): RefObject<T | null>;
  export function useRef<T = undefined>(): RefObject<T | undefined>;
  export function useId(): string;
  export function useSyncExternalStore<T>(
    subscribe: (onStoreChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T;

  export interface Context<T> {
    Provider: FC<{ value: T; children?: ReactNode }>;
    displayName?: string;
  }
  export function createContext<T>(defaultValue: T): Context<T>;
  export function useContext<T>(context: Context<T>): T;

  export function memo<P>(component: FC<P>, areEqual?: (prev: P, next: P) => boolean): FC<P>;
  export function startTransition(scope: () => void): void;
  export function isValidElement(value: unknown): value is ReactElement;

  export const Fragment: FC<{ children?: ReactNode }>;
  export const StrictMode: FC<{ children?: ReactNode }>;

  export class Component<P = {}, S = {}> {
    constructor(props: P);
    readonly props: Readonly<P>;
    state: Readonly<S>;
    setState(state: Partial<S> | ((prev: Readonly<S>) => Partial<S>)): void;
    forceUpdate(): void;
    render(): ReactNode;
    componentDidCatch?(error: Error, info: { componentStack?: string }): void;
    componentDidMount?(): void;
    componentWillUnmount?(): void;
  }

  // ----- Events ---------------------------------------------------------
  export interface SyntheticEvent<T = Element, E = Event> {
    currentTarget: T;
    target: EventTarget & T;
    nativeEvent: E;
    type: string;
    defaultPrevented: boolean;
    preventDefault(): void;
    stopPropagation(): void;
  }
  export interface ChangeEvent<T = Element> extends SyntheticEvent<T> {}
  export interface FormEvent<T = Element> extends SyntheticEvent<T> {}
  export interface FocusEvent<T = Element> extends SyntheticEvent<T, globalThis.FocusEvent> {
    relatedTarget: EventTarget | null;
  }
  export interface KeyboardEvent<T = Element> extends SyntheticEvent<T, globalThis.KeyboardEvent> {
    key: string;
    code: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
  }
  export interface MouseEvent<T = Element> extends SyntheticEvent<T, globalThis.MouseEvent> {
    clientX: number;
    clientY: number;
    button: number;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  }
  export interface PointerEvent<T = Element> extends MouseEvent<T> {
    pointerId: number;
    pointerType: string;
  }
  export interface DragEvent<T = Element> extends MouseEvent<T> {
    dataTransfer: DataTransfer;
  }
  export interface WheelEvent<T = Element> extends MouseEvent<T> {
    deltaX: number;
    deltaY: number;
  }
  export interface AnimationEvent<T = Element> extends SyntheticEvent<T> {
    animationName: string;
  }
  export interface TransitionEvent<T = Element> extends SyntheticEvent<T> {
    propertyName: string;
  }

  export interface CSSProperties {
    [property: string]: string | number | undefined;
  }

  export interface DOMAttributes<T> {
    children?: ReactNode;
    key?: Key | null;
    ref?: Ref<T>;
    className?: string;
    style?: CSSProperties;
    id?: string;
    dangerouslySetInnerHTML?: { __html: string };

    onClick?: (event: MouseEvent<T>) => void;
    onDoubleClick?: (event: MouseEvent<T>) => void;
    onMouseDown?: (event: MouseEvent<T>) => void;
    onMouseUp?: (event: MouseEvent<T>) => void;
    onMouseEnter?: (event: MouseEvent<T>) => void;
    onMouseLeave?: (event: MouseEvent<T>) => void;
    onMouseMove?: (event: MouseEvent<T>) => void;
    onContextMenu?: (event: MouseEvent<T>) => void;
    onPointerDown?: (event: PointerEvent<T>) => void;
    onPointerUp?: (event: PointerEvent<T>) => void;
    onPointerMove?: (event: PointerEvent<T>) => void;
    onPointerCancel?: (event: PointerEvent<T>) => void;
    onPointerEnter?: (event: PointerEvent<T>) => void;
    onPointerLeave?: (event: PointerEvent<T>) => void;
    onWheel?: (event: WheelEvent<T>) => void;
    onChange?: (event: ChangeEvent<T>) => void;
    onInput?: (event: FormEvent<T>) => void;
    onSubmit?: (event: FormEvent<T>) => void;
    onReset?: (event: FormEvent<T>) => void;
    onKeyDown?: (event: KeyboardEvent<T>) => void;
    onKeyUp?: (event: KeyboardEvent<T>) => void;
    onFocus?: (event: FocusEvent<T>) => void;
    onBlur?: (event: FocusEvent<T>) => void;
    onScroll?: (event: SyntheticEvent<T>) => void;
    onDragOver?: (event: DragEvent<T>) => void;
    onDragEnter?: (event: DragEvent<T>) => void;
    onDragLeave?: (event: DragEvent<T>) => void;
    onDrop?: (event: DragEvent<T>) => void;
    onAnimationEnd?: (event: AnimationEvent<T>) => void;
    onTransitionEnd?: (event: TransitionEvent<T>) => void;
    onLoad?: (event: SyntheticEvent<T>) => void;
    onError?: (event: SyntheticEvent<T>) => void;

    /** Any other DOM/ARIA/data attribute. Loosely typed on purpose (see header). */
    [attribute: string]: any;
  }
  export interface HTMLAttributes<T> extends DOMAttributes<T> {}
  export interface SVGAttributes<T> extends DOMAttributes<T> {}

  const React: {
    Fragment: typeof Fragment;
    StrictMode: typeof StrictMode;
  };
  export default React;
}

declare module 'react/jsx-runtime' {
  import type { Component, DOMAttributes, Key, ReactElement, ReactNode } from 'react';

  export namespace JSX {
    type Element = ReactElement;
    type ElementType = string | ((props: any) => ReactNode) | (new (props: any) => Component<any, any>);
    interface ElementClass {
      render(): ReactNode;
    }
    interface ElementAttributesProperty {
      props: {};
    }
    interface ElementChildrenAttribute {
      children: {};
    }
    interface IntrinsicAttributes {
      key?: Key | null;
    }
    type IntrinsicElements = {
      [K in keyof HTMLElementTagNameMap]: DOMAttributes<HTMLElementTagNameMap[K]>;
    } & {
      [K in Exclude<keyof SVGElementTagNameMap, keyof HTMLElementTagNameMap>]: DOMAttributes<SVGElementTagNameMap[K]>;
    };
  }

  export const Fragment: unique symbol;
  export function jsx(type: any, props: any, key?: Key): ReactElement;
  export function jsxs(type: any, props: any, key?: Key): ReactElement;
}

declare module 'react-dom/client' {
  import type { ReactNode } from 'react';
  export interface Root {
    render(children: ReactNode): void;
    unmount(): void;
  }
  export function createRoot(container: Element | DocumentFragment): Root;
}

declare module 'react-dom' {
  import type { ReactNode } from 'react';
  export function createPortal(children: ReactNode, container: Element | DocumentFragment): ReactNode;
  export function flushSync<R>(fn: () => R): R;
}

/**
 * Lightning base components (lightning-input, -combobox, -radio-group, ...) fire `change` events that bubble
 * and cross shadow boundaries. Our components also report their result with a custom `change` event, so a
 * stray native event reaching a parent handler is read as a result with no data. Components that embed
 * base inputs call this once so native events stop at their own boundary.
 * Custom events are dispatched on the component host, outside its shadow tree, and are not affected.
 */
export function isolateNativeEvents(component, names = ['change']) {
    if (component._nativeEventsIsolated) return;
    component._nativeEventsIsolated = true;
    names.forEach(name => component.template.addEventListener(name, event => event.stopPropagation()));
}

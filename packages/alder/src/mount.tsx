import { render } from "solid-js/web";
import { Annotator, type AnnotatorHandle, type AnnotatorProps } from "./components/Annotator";

export interface MountedAnnotator extends AnnotatorHandle {
  destroy(): void;
}

/** Framework-free entry point: mount the annotator into any element.
 * This is the surface an anywidget `render({ model, el })` bridge builds on. */
export function mountAnnotator(
  el: HTMLElement,
  props: Omit<AnnotatorProps, "ref">,
): MountedAnnotator {
  let handle: AnnotatorHandle | undefined;
  const dispose = render(
    () => <Annotator {...props} ref={(h) => (handle = h)} />,
    el,
  );
  return {
    getState: () => handle!.getState(),
    setState: (s) => handle!.setState(s),
    destroy: () => {
      dispose();
      el.textContent = "";
    },
  };
}

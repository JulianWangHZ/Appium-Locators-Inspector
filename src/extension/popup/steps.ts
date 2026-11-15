export type StepState = 'done' | 'active' | 'locked';

export interface FlowState {
    serversReady: boolean;
    platformChosen: boolean;
    deviceChosen: boolean;
}

/** Popup step state machine: servers → platform → device. */
export function stepStates({ serversReady, platformChosen, deviceChosen }: FlowState): [StepState, StepState, StepState] {
    if (!serversReady) return ['active', 'locked', 'locked'];
    if (!platformChosen) return ['done', 'active', 'locked'];
    if (!deviceChosen) return ['done', 'done', 'active'];
    return ['done', 'done', 'done'];
}

export function createSteps(stepEls: HTMLElement[]) {
    // Cache the original step numbers once.
    stepEls.forEach((step, i) => {
        const idx = step.querySelector<HTMLElement>('.step-index');
        if (idx && !idx.dataset.n) idx.dataset.n = String(i + 1);
    });

    function setStepState(step: HTMLElement, state: StepState): void {
        step.dataset.state = state;
        const index = step.querySelector<HTMLElement>('.step-index');
        if (index) index.textContent = state === 'done' ? '✓' : index.dataset.n || index.textContent;
    }

    return {
        update(flow: FlowState): void {
            stepStates(flow).forEach((state, i) => {
                const el = stepEls[i];
                if (el) setStepState(el, state);
            });
        }
    };
}

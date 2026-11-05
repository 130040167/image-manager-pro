import type { Doc } from '../model/doc'
import type { StepResult } from './step'
import { failure, Step, success } from './step'

/** Display range belongs to the document so all editing tools share the same history. */
export class SetValueRange extends Step {
  constructor(readonly before: [number, number] | undefined, readonly after: [number, number] | undefined) {
    super()
  }

  apply(doc: Doc): StepResult {
    if (!doc.background)
      return failure('no background to set value range')
    const background = { ...doc.background }
    if (this.after)
      background.valueRange = [...this.after]
    else
      delete background.valueRange
    return success({ ...doc, background })
  }

  invert(): Step {
    return new SetValueRange(this.after, this.before)
  }

  merge(next: Step): Step | null {
    return next instanceof SetValueRange ? new SetValueRange(this.before, next.after) : null
  }
}

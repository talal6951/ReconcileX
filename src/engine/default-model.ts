import weights from "./model/weights.json";
import { assertCompatible, type LogisticModel } from "./model";

/** The trained model shipped with the engine (produced by `npm run train`). */
export const defaultModel: LogisticModel = weights as LogisticModel;
assertCompatible(defaultModel);

import { createStonSwapPlanner } from './ston-planner.js';
import { createDedustSwapPlanner } from './dedust/planner.js';
import { normalizeSwap } from '../../domain/swaps/input.js';
import { AgentError } from '../../shared/errors.js';

/** DEX selection stays outside the tools, agent loop and financial workflow. */
/** @param {import('../../contracts/chain.js').SwapOptions} options */
export function createSwapPlanner(options) {
  const planners = {
    stonfi: createStonSwapPlanner(options),
    dedust: createDedustSwapPlanner(options),
  };
  const select = (args) => planners[normalizeSwap(args, options.network).dex];
  const approved = (plan) => {
    const planner = planners[plan.receipt?.protocol];
    if (!planner)
      throw new AgentError('unsupported_swap_route', 'This swap uses an unsupported DEX.', {
        effectNotStarted: true,
      });
    return planner;
  };
  return Object.freeze({
    validate: (args) => {
      normalizeSwap(args, options.network);
    },
    quote: (args) => select(args).quote(args),
    plan: (args, operationId) => select(args).plan(args, operationId),
    revalidate: (plan) => approved(plan).revalidate(plan),
    settle: (plan, evidence) => approved(plan).settle(plan, evidence),
  });
}

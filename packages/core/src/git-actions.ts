export * as GitActions from "./git-actions"

import { Context, Effect, Layer } from "effect"
import { Git } from "./git"
import { Location } from "./location"
import { Watcher } from "./filesystem/watcher"
import { makeLocationNode } from "./effect/app-node"

export interface Interface {
  readonly git: Git.Interface
  readonly repository: Git.Repository | undefined
}
export class Service extends Context.Service<Service, Interface>()("@opencode/GitActions") {}

export const node = makeLocationNode({
  service: Service,
  deps: [Git.node, Location.node, Watcher.node],
  layer: Layer.effect(
    Service,
    Effect.gen(function* () {
      const git = yield* Git.Service
      const location = yield* Location.Service
      return { git, repository: yield* git.repo.discover(location.directory) }
    }),
  ),
})

# Design Patterns

Each pattern is used for a concrete reason, not to tick a box.

| Pattern | Where | Why |
|---|---|---|
| Strategy | `LLMProvider` and its five implementations | Providers are interchangeable behind one interface. |
| Template Method | `HttpLLMProvider` | The HTTP flow is written once; subclasses supply URL, headers, body and response parsing. |
| Factory | `LLMProviderFactory` | Providers are created by name, including for the Model Lab. |
| Adapter | each provider class | Adapts a vendor's request/response format to `generate(prompt) -> text`. |
| Composite | `ModelRouter` | A chain of providers is itself an `LLMProvider`, so `AIGenerator` needed no change to gain failover. |
| Chain of Responsibility | `SecurityPipeline` and `SecurityCheck`s | Ordered checks that stop at the first rejection; new checks are added without touching the others. |
| Observer | `SecurityEventManager` / `SecurityEventObserver` (C++); the Node `EventEmitter` bus feeding `auditLogger` | Producers publish events without knowing who records them. |
| Builder | `RecipeBuilder` | Assembles and validates a `Recipe` from untrusted fields in one place. |
| RAII | `FileLock` | The storage lock is released on every path, including exceptions. |
| Inheritance / polymorphism | `Recipe` -> `TraditionalRecipe`, `AIRecipe`; `RecipeGenerator` -> `DatabaseGenerator`, `AIGenerator` | Different sources, one interface. |
| Dependency injection | `HttpClient`, `runEngine` (Node), `now()` clocks | Tests replace the network, the engine and time. |

Other OOP ideas in use: encapsulation (private state with accessors), abstract classes (`Recipe`, `LLMProvider`, `SecurityCheck`), custom exceptions (`ValidationException`, `StorageException`, `InvalidRecipeException`, `AIOutputValidationException`), composition (`AIGenerator` owns a router), and static helpers where state is not needed (`Validator`, `IngredientConsistencyChecker`).

Not built: a `StorageRepository` abstraction over `RecipeStorage` (JSON file only), and C++ `AlertManager` / `SecurityDashboard` observers.

# Effect Code Style

## Imports

```ts
// Importy namespace pokazują, z którego modułu Effect pochodzi każde API.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

// Import używany wyłącznie jako typ pozostaje type-only.
import type { ClientOptions } from "./ClientOptions";
```

## Models

```ts
// Namespace import utrzymuje jawne pochodzenie operatorów Schema.
import * as Schema from "effect/Schema";

// Prymityw jest walidowany i brandowany raz, przy definicji kontraktu.
export const ResourceId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128)),
  Schema.brand("example/ResourceId")
);
export type ResourceId = Schema.Schema.Type<typeof ResourceId>;

// Encja z tożsamością jest Schema.Class.
export class Resource extends Schema.Class<Resource>("example/Resource")({
  id: ResourceId,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
}) {}

// Invariant obejmujący kilka pól jest częścią checked schema.
export const ResourceSchema = Resource.check(
  Schema.makeFilter((resource) =>
    resource.updatedAt >= resource.createdAt
      ? undefined
      : "updatedAt cannot be earlier than createdAt"
  )
);

// Komenda bez własnej tożsamości jest Schema.Struct, nie klasą.
export const UpdateResource = Schema.Struct({
  id: ResourceId,
  expectedUpdatedAt: Schema.Number,
});
export type UpdateResource = Schema.Schema.Type<typeof UpdateResource>;

// `unknown` przekracza granicę dopiero po dekodowaniu.
export const decodeResource = Schema.decodeUnknownEffect(ResourceSchema);
```

## Services And Layers

```ts
// application/EventProcessor.ts

// Namespace imports utrzymują jawne pochodzenie API Effect.
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EventProjector } from "./EventProjector";
import { EventRepository } from "./EventRepository";
import type { DomainEvent } from "./EventSchema";
import { RequestContext } from "./RequestContext";

export class EventEnqueueError extends Data.TaggedError("EventEnqueueError")<{
  readonly cause?: unknown;
}> {}

// W application code `make` i standardowe layery są statycznymi properties.
// Nie są tree-shakeable, ale tutaj ergonomia autocomplete ma pierwszeństwo.
export class EventProcessor extends Context.Service<
  EventProcessor,
  {
    readonly enqueue: (
      event: DomainEvent
    ) => Effect.Effect<void, EventEnqueueError, RequestContext>;
  }
>()("example/EventProcessor", {
  // `make` przechwytuje lokalne zależności konstrukcyjne serwisu.
  make: Effect.gen(function* () {
    const repository = yield* EventRepository;
    const projector = yield* EventProjector;

    return EventProcessor.of({
      enqueue: (event) =>
        Effect.gen(function* () {
          // Zależność per-request pozostaje widoczna w typie metody.
          const requestContext = yield* RequestContext;
          yield* repository.enqueue(event, requestContext.requestId);
          yield* projector.project(event);
        }).pipe(Effect.mapError((cause) => new EventEnqueueError({ cause }))),
    });
  }),
}) {
  // Bez lokalnego provide: test może podmienić wszystkie zależności `make`.
  static readonly layerNoDeps = Layer.effect(this, this.make);

  // Zależne layery mają lowercase names i są provide'owane lokalnie.
  // Layer memoizuje współdzielone zależności, więc nie wypychamy ich na boundary.
  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide([EventRepository.layer, EventProjector.layer])
  );

  // Częściowy mock implementuje tylko metody potrzebne w typowym teście.
  static readonly mockLayer = Layer.mock(this, {
    enqueue: () => Effect.void,
  });
}
```

```ts
// Test wybiera `layerNoDeps`, aby zastąpić lokalne zależności serwisu.
export const EventProcessorTestLayer = EventProcessor.layerNoDeps.pipe(
  Layer.provide([EventRepository.mockLayer, EventProjector.mockLayer])
);
```

## Tree-Shakeable Service Layers

```ts
// library/TaskRunner.ts
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { Task, TaskError } from "./Task";
import { TaskRepository } from "./TaskRepository";

// W bibliotece unikamy statycznych properties, bo nie są tree-shakeable.
export class TaskRunner extends Context.Service<
  TaskRunner,
  { readonly run: (task: Task) => Effect.Effect<void, TaskError> }
>()("example/TaskRunner", {
  make: Effect.gen(function* () {
    const repository = yield* TaskRepository;
    return TaskRunner.of({ run: (task) => repository.run(task) });
  }),
}) {}

// Wyjątek namingowy dla biblioteki: exports obok serwisu pozostają lowercase,
// dzięki czemu bundler może usunąć każdy nieużywany Layer osobno.
export const layerNoDeps = Layer.effect(TaskRunner, TaskRunner.make);
export const layer = layerNoDeps.pipe(Layer.provide(TaskRepository.layer));
export const mockLayer = Layer.mock(TaskRunner, {
  run: () => Effect.void,
});

// Powtarzalne nazwy pogarszają autocomplete; ten wariant wybieramy tylko wtedy,
// gdy tree-shaking biblioteki jest ważniejszy niż ergonomia statycznych properties.
```

## Top-Level Layers

```ts
import * as Effect from "effect/Effect";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { ApplicationApi } from "./ApplicationApi";

// Top-level Layer utworzony przez API ma opisową nazwę z suffixem `Layer`.
export const ResourceApiLayer = HttpApiBuilder.group(
  ApplicationApi,
  "resources",
  Effect.fn("http.resources")(function* (handlers) {
    return handlers.handle("list", () => Effect.succeed([]));
  })
);
```

## Control Flow And Errors

```ts
// Namespace imports odróżniają operatory Effect, HTTP i Schema.
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

const ResponseSchema = Schema.Struct({ value: Schema.String });
const decodeResponse = HttpClientResponse.schemaBodyJson(ResponseSchema);

// Krótka transformacja używa pipe; obsługiwane są konkretne tagi błędów.
const result = client.execute(request).pipe(
  Effect.flatMap(decodeResponse),
  Effect.catchTags({
    HttpClientError: (cause) => Effect.fail(mapTransportError(cause)),
    SchemaError: (cause) => Effect.fail(mapDecodeError(cause)),
  })
);
```

## Observability

```ts
// request-boundary.ts

// Namespace imports utrzymują jawne pochodzenie API telemetrycznych.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { ResourceProcessor } from "./ResourceProcessor";
import type { ProcessInput } from "./ResourceSchema";

const TelemetryId = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128))
);
export const RequestId = TelemetryId.pipe(Schema.brand("example/RequestId"));
export const CorrelationId = TelemetryId.pipe(
  Schema.brand("example/CorrelationId")
);

// Jeden kontekst przenosi tożsamość żądania przez cały graf Effect.
export class RequestContext extends Schema.Class<RequestContext>(
  "example/RequestContext"
)({
  correlationId: CorrelationId,
  requestId: RequestId,
}) {}

export class CurrentRequestContext extends Context.Service<
  CurrentRequestContext,
  RequestContext
>()("example/CurrentRequestContext") {}

// Nazwane Effect.fn stosujemy na istotnych granicach operacji, nie dla trywialnych helperów.
// Automatycznie tworzy span i zachowuje stack-frame metadata.
// Nazwa spana jest stała; identyfikatory trafiają do attributes, nigdy do nazwy.
export const processResource = Effect.fn("resource.process")(function* (
  input: ProcessInput
) {
  const context = yield* CurrentRequestContext;
  const processor = yield* ResourceProcessor;

  yield* Effect.annotateCurrentSpan({
    // High-cardinality IDs są potrzebne do korelacji pojedynczego żądania.
    "correlation.id": context.correlationId,
    "request.id": context.requestId,
    // Bounded business context pozwala analizować wpływ, nie tylko awarię techniczną.
    "resource.kind": input.kind,
    "resource.item_count": input.items.length,
  });

  // Spany opisują kroki operacji; nie emitujemy osobnego loga dla każdego kroku.
  // Do telemetry nie trafiają sekrety, tokeny, raw body ani nieograniczony user input.
  return yield* processor.process(input);
});

const requestEffect = handler(request).pipe(
  Effect.provideService(CurrentRequestContext, requestContext),
  // Wspólne annotations są automatycznie dziedziczone przez logi tego żądania.
  Effect.annotateLogs({
    "correlation.id": requestContext.correlationId,
    "request.id": requestContext.requestId,
  }),
  // Route jest znormalizowany i low-cardinality; nie używamy surowego URL-a.
  Effect.withSpan("http.request", {
    attributes: {
      "http.request.method": request.method,
      "http.route": normalizedRoute,
    },
    kind: "server",
  })
);

// Transport propaguje trace context; child spans nie wymuszają nowego root spana.
```

```ts
// request-completion.ts

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { CorrelationId, RequestId } from "./request-boundary";

const RequestOutcome = Schema.Literals(["succeeded", "rejected", "failed"]);
const DurationMillis = Schema.Number.pipe(
  Schema.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
);
const ItemCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0))
);
const HttpStatus = Schema.Int.pipe(
  Schema.check(
    Schema.isGreaterThanOrEqualTo(100),
    Schema.isLessThanOrEqualTo(599)
  )
);
const TelemetryName = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 128))
);
const NormalizedRoute = Schema.Trimmed.pipe(
  Schema.check(Schema.isLengthBetween(1, 256))
);

// Wide event ma stabilny, wersjonowany schemat wspólny dla wszystkich żądań.
export class RequestCompletedEvent extends Schema.Class<RequestCompletedEvent>(
  "example/RequestCompletedEvent"
)({
  correlationId: CorrelationId,
  deploymentRegion: TelemetryName,
  durationMillis: DurationMillis,
  // Error tag jest stabilnym typem błędu, nie message, stackiem ani raw cause.
  errorTag: Schema.optional(TelemetryName),
  eventName: Schema.Literal("request.completed"),
  itemCount: ItemCount,
  operation: TelemetryName,
  outcome: RequestOutcome,
  requestId: RequestId,
  route: NormalizedRoute,
  schemaVersion: Schema.Literal(1),
  serviceName: TelemetryName,
  serviceVersion: TelemetryName,
  statusCode: HttpStatus,
}) {}

const requestCompletedAnnotations = (
  event: RequestCompletedEvent
): Record<string, unknown> => ({
  "correlation.id": event.correlationId,
  "deployment.region": event.deploymentRegion,
  duration_ms: event.durationMillis,
  ...(event.errorTag === undefined ? {} : { "error.type": event.errorTag }),
  "event.name": event.eventName,
  "event.outcome": event.outcome,
  "event.schema_version": event.schemaVersion,
  "http.response.status_code": event.statusCode,
  "http.route": event.route,
  "operation.name": event.operation,
  "request.id": event.requestId,
  "resource.item_count": event.itemCount,
  "service.name": event.serviceName,
  "service.version": event.serviceVersion,
});

// Middleware/finalizer emituje dokładnie jeden szeroki event na request i service hop.
// Błąd pozostaje w kanale Effect; completion event nie zastępuje jego propagacji.
// Używamy loggera Effect skonfigurowanego raz na program boundary, nie lokalnych loggerów.
export const emitRequestCompleted = (event: RequestCompletedEvent) =>
  // Expected rejection (np. 4xx) pozostaje Info; tylko awaria operacji jest Error.
  (event.outcome === "failed"
    ? Effect.logError(event.eventName)
    : Effect.logInfo(event.eventName)
  ).pipe(Effect.annotateLogs(requestCompletedAnnotations(event)));
```

### Log Levels

```ts
import * as Effect from "effect/Effect";

// Normalny request flow nadal emituje jeden wide event. Dodatkowe logi opisują
// lifecycle, istotną zmianę stanu albo jawnie włączoną diagnostykę.

// Trace: bardzo częsta diagnostyka protokołu; domyślnie wyłączona lub samplowana.
const frameReceived = Effect.logTrace("protocol.frame_received").pipe(
  Effect.annotateLogs({ "protocol.frame_type": frame.type })
);

// Debug: stan pomocny podczas developmentu, zbędny w normalnej obsłudze produkcji.
const cacheDecision = Effect.logDebug("cache.lookup_completed").pipe(
  Effect.annotateLogs({ "cache.outcome": "miss" })
);

// Info: oczekiwany lifecycle, sukces lub kontrolowane odrzucenie operacji.
const serviceStarted = Effect.logInfo("service.started").pipe(
  Effect.annotateLogs({
    "service.name": serviceName,
    "service.version": serviceVersion,
  })
);

// Warning: degradacja została obsłużona, ale wymaga obserwacji, np. otwarty circuit.
const circuitOpened = Effect.logWarning("provider.circuit_opened").pipe(
  Effect.annotateLogs({ "provider.name": providerName })
);

// Error: terminalna awaria operacji; nie logujemy tego samego błędu w każdej warstwie.
const jobFailed = Effect.logError("job.completed").pipe(
  Effect.annotateLogs({
    "error.type": error._tag,
    "event.outcome": "failed",
    "job.type": jobType,
  })
);

// Fatal: proces nie może bezpiecznie wystartować lub kontynuować pracy.
const startupFailed = Effect.logFatal("service.startup_failed").pipe(
  Effect.annotateLogs({ "error.type": startupError._tag }),
  Effect.andThen(Effect.die(startupError))
);

// Nazwy eventów i klucze są stabilne; zmienne dane trafiają wyłącznie do annotations.
// Logger Effect jest filtrowany i eksportowany centralnie na program boundary.
```

### Metrics

```ts
// Namespace imports odróżniają instrumentację Effect, Exit i Metric.
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Metric from "effect/Metric";

// Frequency mierzy traffic i outcome, timer latency, a gauge saturation.
const requestOutcomes = Metric.frequency("http_request_outcomes", {
  description: "Completed HTTP requests by outcome",
});
const requestDuration = Metric.timer("http_request_duration", {
  description: "HTTP request duration",
});
const queueDepth = Metric.gauge("worker_queue_depth", {
  description: "Number of queued work items",
});

// Każda kombinacja attributes tworzy osobną serię: używamy tylko bounded values.
// Request ID, user ID, surowy URL i error message nigdy nie są metric labels.
const metricAttributes = {
  method: normalizedMethod,
  route: normalizedRoute,
  service: serviceName,
};

const observedRequest = requestEffect.pipe(
  Effect.track(
    requestOutcomes.pipe(Metric.withAttributes(metricAttributes)),
    (exit) =>
      Exit.isFailure(exit)
        ? "failed"
        : exit.value.status >= 500
          ? "failed"
          : exit.value.status >= 400
            ? "rejected"
            : "succeeded"
  ),
  Effect.trackDuration(
    requestDuration.pipe(Metric.withAttributes(metricAttributes))
  )
);

// Gauge jest aktualizowany stanem bieżącym, nie inkrementowany jak counter.
const updateQueueDepth = (pending: number) =>
  Metric.update(queueDepth, pending);

// Alerty i SLO opieramy na outcome, latency i saturation, nie na pojedynczym logu.
```

### Exporters And Sampling

```ts
// observability.ts
import * as Layer from "effect/Layer";

import { JsonLoggerLayer } from "./JsonLogger";
import { MetricsExporterLayer } from "./MetricsExporter";
import { TracingExporterLayer } from "./TracingExporter";

// Logger, trace exporter i metric exporter są konfigurowane raz na program boundary.
// Warstwy dodają service/version/region, wspólną redakcję i politykę samplingową.
export const ObservabilityLayer = Layer.mergeAll(
  JsonLoggerLayer,
  MetricsExporterLayer,
  TracingExporterLayer
);

// Sampling ogranicza wolumen, ale zawsze zachowuje błędy i reprezentatywny baseline.
// Awaria eksportera nie zmienia błędu domenowego; stan eksportera ma własny health signal.
```

## Resources

```ts
// Namespace imports pokazują, że lifecycle jest zarządzany przez Effect.
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ConnectionConfig } from "./ConnectionConfig";
import { openConnection, type ConnectionClient } from "./ConnectionClient";

export class Connection extends Context.Service<Connection, ConnectionClient>()(
  "example/Connection",
  {
    make: Effect.gen(function* () {
      const config = yield* ConnectionConfig;

      // acquireRelease uruchamia cleanup po sukcesie, błędzie i przerwaniu fibera.
      return yield* Effect.acquireRelease(
        openConnection(config),
        (connection) => connection.close
      );
    }),
  }
) {
  // Layer.scoped przenosi czas życia zasobu do grafu Layer.
  static readonly layerNoDeps = Layer.scoped(this, this.make);
  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide(ConnectionConfig.layer)
  );
}
```

## Composition Root

```ts
// Namespace import wyróżnia operacje składania grafu Layer.
import * as Layer from "effect/Layer";

import { EventProcessor } from "./EventProcessor";
import { HealthApiLayer } from "./HealthApi";
import { ObservabilityLayer } from "./Observability";
import { RequestContextMiddlewareLayer } from "./RequestContextMiddleware";
import { ResourceApiLayer } from "./ResourceApi";

// API dostaje zależności lokalnie; domyślne `EventProcessor.layer` jest kompletne.
const ResourceApiWithDependenciesLayer = ResourceApiLayer.pipe(
  Layer.provide([EventProcessor.layer, RequestContextMiddlewareLayer])
);

// Program boundary otrzymuje mały, gotowy graf zamiast listy zależności pośrednich.
export const ApplicationLayer = Layer.mergeAll(
  HealthApiLayer,
  ObservabilityLayer,
  ResourceApiWithDependenciesLayer
);
```

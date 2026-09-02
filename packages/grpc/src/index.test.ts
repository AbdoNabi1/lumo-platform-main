import { describe, expect, it } from "vitest";
import type { ServiceClientConstructor } from "@grpc/grpc-js";
import { createGrpcServer, loadProto } from "./index";

describe("gRPC contracts", () => {
  it("loads the versioned Orders v1 service with all three rpcs (no manual serialization)", () => {
    const proto = loadProto("lumo/orders/v1/orders.proto") as {
      lumo: { orders: { v1: { OrdersService: ServiceClientConstructor } } };
    };
    const methods = Object.keys(proto.lumo.orders.v1.OrdersService.service);
    expect(methods).toEqual(expect.arrayContaining(["PlaceOrder", "MarkOrderPaid", "RefundOrder"]));
  });

  it("binds a service implementation into a server (interceptor seam accepted)", () => {
    const proto = loadProto("lumo/orders/v1/orders.proto") as {
      lumo: { orders: { v1: { OrdersService: ServiceClientConstructor } } };
    };
    const server = createGrpcServer(
      [
        {
          definition: proto.lumo.orders.v1.OrdersService.service,
          implementation: {
            placeOrder: () => undefined,
            markOrderPaid: () => undefined,
            refundOrder: () => undefined,
          },
        },
      ],
      { interceptors: [] },
    );
    expect(server).toBeDefined();
  });
});

import { InMemoryProfileStore } from "./in-memory-profile-store";
import { runProfileStoreContractTests } from "./profile-store.contract";

runProfileStoreContractTests("in-memory", () => new InMemoryProfileStore());

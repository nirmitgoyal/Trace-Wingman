import { Router } from "express";
import {
  resetHandler,
  illnessesHandler,
  seedHandler,
  outbreakHandler,
  vectorBenchHandler,
  oddCasesHandler,
  fullRunHandler,
  statusHandler,
} from "../controllers/stressController";

const router = Router();

router.post("/reset", resetHandler);
router.post("/illnesses", illnessesHandler);
router.post("/seed", seedHandler);
router.post("/outbreak", outbreakHandler);
router.post("/vector-bench", vectorBenchHandler);
router.post("/odd-cases", oddCasesHandler);
router.post("/full-run", fullRunHandler);
router.get("/status", statusHandler);

export default router;

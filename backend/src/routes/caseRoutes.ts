import { Router } from "express";
import { 
    getCases, 
    getCaseById, 
    createCase, 
    getStats, 
    getStream, 
    claimCase, 
    resolveCase, 
    getVillageStats,
    getLocationSuggestions
} from "../controllers/caseController";

const router = Router();

router.get("/", getCases);
router.get("/stats", getStats);
router.get("/village-stats", getVillageStats);
router.get("/stream", getStream);
router.get("/locations", getLocationSuggestions);
router.get("/:id", getCaseById);
router.post("/", createCase);
router.post("/:id/claim", claimCase);
router.post("/:id/resolve", resolveCase);

export default router;

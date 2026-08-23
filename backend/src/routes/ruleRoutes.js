import express from 'express';
import { RuleCache } from '../models/RuleCache.js';
import { RuleDefinitionSchema } from '../schemas/aiSchemas.js';

export const ruleRouter = express.Router();

/**
 * List all self-healing rules
 */
ruleRouter.get('/', async (req, res) => {
  try {
    const rules = await RuleCache.find().sort({ usageCount: -1, createdAt: -1 }).lean();
    return res.json(rules);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Create a new rule
 */
ruleRouter.post('/', async (req, res) => {
  try {
    const parsed = RuleDefinitionSchema.parse(req.body);
    const newRule = await RuleCache.create({
      ...parsed,
      partyIdentifier: parsed.partyIdentifier.toUpperCase(),
      source: 'MANUAL',
    });
    return res.status(201).json(newRule);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

/**
 * Toggle active status or update rule parameters
 */
ruleRouter.put('/:id', async (req, res) => {
  try {
    const updated = await RuleCache.findByIdAndUpdate(
      req.params.id,
      { $set: req.body },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Rule not found' });
    return res.json(updated);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

/**
 * Delete a rule
 */
ruleRouter.delete('/:id', async (req, res) => {
  try {
    const deleted = await RuleCache.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Rule not found' });
    return res.json({ success: true, message: 'Rule deleted' });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

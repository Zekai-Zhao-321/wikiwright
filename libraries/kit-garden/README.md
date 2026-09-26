# kit-garden

The neutral test library (v2 contracts §1), id `garden`: a type library of
data only — type, fragment and vocabulary documents, rule tests and examples —
for a kitchen garden's plantings and beds. It carries no semantics a real
bundle needs (the navigator's ruling 4); the allotment handbook imports it
(`libraries: [{"path": "libraries/kit-garden"}]`), so its rule tests and its
examples are judged whenever that handbook is.

- `types/planting.yaml`: one sowing of one crop in one bed; abstract, so a
  bundle writes its pages under a type that extends `garden/planting`.
- `types/bed.yaml`: one bed of the garden.
- `fragments/planted.yaml`: the bed and the sowing date, and the rule
  `known-bed` (the bed is one the garden has; a bundle extends the list with
  `configure`).
- `vocabularies/relations.yaml` and `vocabularies/observations.yaml`: the
  labels a planting's Relations read and the categories its Observations read.

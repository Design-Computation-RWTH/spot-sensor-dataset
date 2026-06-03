# spot-reloc-annotation-tool

A web-based annotation application for spatially contextualizing sensor documentation resources using Linked Data vocabularies. Developed as part of the [Spatio-B-RAG project](https://www.dfg.de), funded by the Deutsche Forschungsgemeinschaft (DFG, German Research Foundation) – 562882930. The project is part of the DFG-funded Priority Program SPP 2388, "Hundred plus - Extending the Lifetime of Complex Engineering Structures through Intelligent Digitalization".

---

## Overview

The tool supports the manual annotation of heterogeneous sensor documentation resources — technical drawings, photographs, and textual descriptions — and transforms them into an RDF dataset. Spatial relationships between sensors, their observations, and monitored structural components are expressed using the following ontologies:

- **[SPOT](https://w3id.org/spot#)**  — Space Types Ontology: classifies physical and virtual space types (e.g., `spot:EntitySpace`, `spot:DocumentSpace`, `spot:AssetSpace`)
- **[RELOC](https://w3id.org/reloc#)** — Relative Location Ontology: expresses qualitative directional and topological spatial relations (e.g., `reloc:containedInBottom`)
- **[SOSA](https://www.w3.org/TR/vocab-ssn/)** — Sensor, Observation, Sample, and Actuator Ontology: describes sensors, observations, observable properties, and features of interest

The resulting RDF graph enables SPARQL queries over qualitative and quantitative spatial relations between sensors, structural components, and the documentation resources in which they appear.

---

## Features

- Frame, classify, and spatially align reference spaces (drawings, photographs, text) to the built asset via axis and boundary-point mappings
- Annotate sensor positions, orientations, extents, and observed properties relative to reference spaces
- Link individual sensor appearances across resources to a shared RDF sensor instance
- Automatic OCR-based text extraction from reference spaces
- Axis coverage checking: flags whether complementary 2D appearances across orthogonal reference planes (e.g., XY and XZ) are sufficient to derive a full 3D representation
- RDF graph export aligned with SPOT, RELOC, and SOSA

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Shift + D` | Toggle dark / light mode |
| `H` | Hide all annotations |
| `Shift + H` | Hide labels only |
| `F` | Flatten document |

---

## Export

Annotations are exported as an RDF graph serialized in Turtle (`.ttl`). The graph can be queried using any standard SPARQL 1.1 endpoint.

---

## Related Publication

Rolke, F., Becks, H., Göbels, A., Schulz, O., Beetz, J., 2026. Ontology-based Integration of Spatial Sensor Information in Digital Twins. In: Proceedings of the 8th International Conference on Smart Monitoring, Assessment and Rehabilitation of Civil Structures (SMAR 2026).

---

## License

This project is licensed under the **Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License (CC BY-NC-ND 4.0)**.

You are free to share and use this work for non-commercial purposes, provided appropriate credit is given. No derivatives or adaptations may be distributed without prior permission.

Full license text: [https://creativecommons.org/licenses/by-nc-nd/4.0](https://creativecommons.org/licenses/by-nc-nd/4.0)

---

## Acknowledgements

This research is part of the DFG-funded Priority Programme SPP 2388, *"Hundred plus — Extending the Lifetime of Complex Engineering Structures through Intelligent Digitalization"*.

Department of Design Computation, Faculty of Architecture, RWTH Aachen University.

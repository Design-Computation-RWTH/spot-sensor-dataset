# spot-sensor-dataset

This repository contains a spatial RDF dataset of a sensor installation documentation from the Nibelungen Bridge in Worms, Germany. The dataset primarily makes use of the SPOT, RELOC, and SOSA ontologies to explicitly express spatial relations between sensors, their observations, their monitored components, and the resources documenting them.

---

## Contents

| Path | Description |
|------|-------------|
| `spot_sensor_dataset.ttl` | Full RDF dataset in Turtle serialization |
| `queries/` | Exemplary SPARQL queries |
| `app/` | Source code of the annotation application used to produce the dataset |

---

## Dataset

The dataset was derived from a 42-page sensor installation documentation PDF comprising 165 reference spaces (technical drawings, photographs, and textual descriptions). It covers 20 sensors and 4 sensor network components installed on the Nibelungen Bridge as part of the DFG-funded Priority Programme SPP 2388.

Spatial relations are expressed qualitatively using:

- **[SPOT](https://w3id.org/spot#)**  — Space Types Ontology: classifies physical and virtual space types (e.g., `spot:EntitySpace`, `spot:DocumentSpace`, `spot:AssetSpace`)
- **[RELOC](https://w3id.org/reloc#)** — Relative Location Ontology: expresses qualitative directional and topological spatial relations (e.g., `reloc:containedInBottom`)
- **[SOSA](https://www.w3.org/TR/vocab-ssn/)** — Sensor, Observation, Sample, and Actuator Ontology: describes sensors, observations, observable properties, and features of interest

---

## Annotation Application

The `app/` directory contains the source code of the web-based annotation tool used to produce the dataset. For usage instructions and keyboard shortcuts, see [`app/README.md`](app/README.md).

---

## SPARQL Queries

The `queries/` directory contains exemplary queries demonstrating retrieval of:

- Sensor appearances within specific documentation resources
- Topological and directional relations between sensors and monitored components
- 3D position and axis alignment derived from complementary 2D reference spaces

Queries are compatible with any standard SPARQL 1.1 endpoint.

---

## Related Publication

Rolke, F., Becks, H., Göbels, A., Schulz, O., Beetz, J., 2026. Ontology-based Integration of Spatial Sensor Information in Digital Twins. In: Proceedings of the 8th International Conference on Smart Monitoring, Assessment and Rehabilitation of Civil Structures (SMAR 2026).

---

## License

The dataset and application source code are released under the **Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International License (CC BY-NC-ND 4.0)**.

Full license text: [https://creativecommons.org/licenses/by-nc-nd/4.0](https://creativecommons.org/licenses/by-nc-nd/4.0)

---

## Acknowledgements

This research is part of the Spatio-B-RAG project funded by the German Research Foundation (DFG), project number 562882930, within the DFG-funded Priority Programme SPP 2388, *"Hundred plus — Extending the Lifetime of Complex Engineering Structures through Intelligent Digitalization"*.

Department of Design Computation, Faculty of Architecture, RWTH Aachen University.

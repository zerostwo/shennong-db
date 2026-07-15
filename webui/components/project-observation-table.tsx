"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Plus, Save, Trash2, TriangleAlert } from "lucide-react";
import {
  submitProjectObservations,
  type ObservationDraft,
  type ObservationSubmissionReport,
} from "@/lib/api/adapter";
import { SectionHeader } from "./app-shell";

type EditableObservation = {
  clientId: string;
  sampleEntityId: string;
  measurementType: string;
  value: string;
  unit: string;
};

const MAX_ROWS = 50;

export function ProjectObservationTable({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<EditableObservation[]>(() => [emptyRow()]);
  const [validationError, setValidationError] = useState("");
  const [report, setReport] = useState<ObservationSubmissionReport | null>(null);
  const mutation = useMutation({
    mutationFn: (values: ObservationDraft[]) => submitProjectObservations(projectId, values),
    onSuccess: async (nextReport) => {
      setReport(nextReport);
      if (nextReport.complete) {
        setRows([emptyRow()]);
        await queryClient.invalidateQueries({ queryKey: ["projects", projectId, "context-pack"] });
      }
    },
  });

  function updateRow(clientId: string, key: keyof Omit<EditableObservation, "clientId">, value: string) {
    setRows((current) => current.map((row) => row.clientId === clientId ? { ...row, [key]: value } : row));
    setValidationError("");
    setReport(null);
  }

  function addRow() {
    setRows((current) => current.length >= MAX_ROWS ? current : [...current, emptyRow()]);
  }

  function removeRow(clientId: string) {
    setRows((current) => current.length === 1 ? [emptyRow()] : current.filter((row) => row.clientId !== clientId));
    setReport(null);
  }

  function submit() {
    const parsed: ObservationDraft[] = [];
    for (const [index, row] of rows.entries()) {
      const value = Number(row.value);
      if (!row.sampleEntityId.trim() || !row.measurementType.trim() || !row.unit.trim() || row.value.trim() === "" || !Number.isFinite(value)) {
        setValidationError(`Row ${index + 1} requires an existing sample/entity ID, measurement type, finite numeric value, and unit.`);
        return;
      }
      parsed.push({
        sampleEntityId: row.sampleEntityId.trim(),
        measurementType: row.measurementType.trim(),
        value,
        unit: row.unit.trim(),
      });
    }
    setValidationError("");
    setReport(null);
    mutation.mutate(parsed);
  }

  return (
    <section className="project-panel observation-panel">
      <SectionHeader
        title="Structured observations"
        description="Record small, human-entered measurements. Raw instrument files belong in the upload workflow."
        action={<button className="outline-button" type="button" onClick={addRow} disabled={rows.length >= MAX_ROWS || mutation.isPending}><Plus />Add row</button>}
      />
      <p className="observation-contract-note">Each batch creates one persisted Activity; every completed row creates an Observation Entity, Activity output link, Association, Evidence Item, and evidence link. “Sample / entity ID” must already exist in this project or as an allowed global entity.</p>
      {validationError ? <div className="form-error-summary" role="alert">{validationError}</div> : null}
      {mutation.error ? <div className="form-error-summary" role="alert">{mutation.error instanceof Error ? mutation.error.message : "Observation submission failed."}</div> : null}
      <div className="observation-table-wrap">
        <table className="observation-table">
          <thead><tr><th>Sample / entity ID</th><th>Measurement type</th><th>Value</th><th>Unit</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{rows.map((row, index) => (
            <tr key={row.clientId}>
              <td><input aria-label={`Row ${index + 1} sample or entity ID`} value={row.sampleEntityId} onChange={(event) => updateRow(row.clientId, "sampleEntityId", event.target.value)} placeholder="sample-001" /></td>
              <td><input aria-label={`Row ${index + 1} measurement type`} value={row.measurementType} onChange={(event) => updateRow(row.clientId, "measurementType", event.target.value)} placeholder="ct_value, band_intensity…" /></td>
              <td><input aria-label={`Row ${index + 1} value`} type="number" step="any" value={row.value} onChange={(event) => updateRow(row.clientId, "value", event.target.value)} placeholder="0.0" /></td>
              <td><input aria-label={`Row ${index + 1} unit`} value={row.unit} onChange={(event) => updateRow(row.clientId, "unit", event.target.value)} placeholder="Ct, AU, %…" /></td>
              <td><button type="button" className="row-action danger" aria-label={`Remove observation row ${index + 1}`} onClick={() => removeRow(row.clientId)} disabled={mutation.isPending}><Trash2 /></button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {report ? <SubmissionReport report={report} /> : null}
      <div className="observation-actions">
        <span>{rows.length} of {MAX_ROWS} rows</span>
        <button type="button" className="primary-button" onClick={submit} disabled={mutation.isPending}><Save />{mutation.isPending ? "Persisting graph records…" : "Record observations"}</button>
      </div>
    </section>
  );
}

function SubmissionReport({ report }: { report: ObservationSubmissionReport }) {
  if (report.complete) {
    return <div className="observation-result success" role="status"><CheckCircle2 /><span><strong>Observation batch persisted with evidence.</strong>{report.entities.length} entities, {report.activityIo.length} activity output links, {report.associations.length} associations, and {report.associationEvidence.length} evidence links were created.</span></div>;
  }
  return (
    <div className="observation-result partial" role="alert">
      <TriangleAlert />
      <span><strong>Submission partially persisted; no success was reported.</strong>{report.entities.length} entities, {report.activityIo.length} activity output links, {report.associations.length} associations, {report.evidence.length} evidence items, and {report.associationEvidence.length} evidence links exist. Review before retrying to avoid duplicates.</span>
      <ul>{report.failures.map((failure, index) => <li key={`${failure.phase}-${failure.row}-${index}`}>{failure.phase}{failure.row === null ? "" : ` row ${failure.row + 1}`}: {failure.message}</li>)}</ul>
    </div>
  );
}

function emptyRow(): EditableObservation {
  return { clientId: globalThis.crypto.randomUUID(), sampleEntityId: "", measurementType: "", value: "", unit: "" };
}

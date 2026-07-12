"use client";

import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useRouter } from "next/navigation";
import { Check, File, UploadCloud } from "lucide-react";
import { uploadSchema, type UploadForm } from "@/features/uploads/schema";
import { AppShell, SectionHeader, TopBar } from "./app-shell";

const steps = [
  "Select files",
  "Describe dataset",
  "Map artifacts",
  "Access",
  "Review",
  "Upload",
] as const;
export function UploadView() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [progress, setProgress] = useState(72);
  const [cancelOpen, setCancelOpen] = useState(false);
  const {
    register,
    trigger,
    getValues,
    formState: { errors },
  } = useForm<UploadForm>({
    resolver: zodResolver(uploadSchema),
    defaultValues: {
      name: "PBMC snapshot 2026-07-12",
      description: "Single-cell RNA-seq expression matrix and metadata.",
      organism: "Homo sapiens",
      modality: "Single-cell RNA-seq",
      assay: "10x 3′ gene expression",
      reference: "GRCh38",
      annotation: "GENCODE v44",
      role: "Primary matrix",
      format: "H5AD",
      dataClass: "canonical",
      compression: "Automatic",
      visibility: "Private",
      grantUsers: "",
      scopes: "resource.read, query.execute",
    },
  });
  async function next() {
    if (step === 0 && files.length === 0)
      setFiles(["pbmc-expression.h5ad", "pbmc-metadata.tsv", "manifest.json"]);
    if (
      step === 1 &&
      !(await trigger([
        "name",
        "description",
        "organism",
        "modality",
        "assay",
        "reference",
        "annotation",
      ]))
    )
      return;
    setStep((value) => Math.min(5, value + 1));
  }
  const values = getValues();
  return (
    <AppShell active="uploads">
      <TopBar
        title="New upload"
        description="Register files as a governed ShennongDB resource."
        search={false}
      />
      <div className="upload-page">
        <div className="upload-stepper">
          {steps.map((label, index) => (
            <button
              key={label}
              className={
                index === step ? "active" : index < step ? "complete" : ""
              }
              onClick={() => index <= step && setStep(index)}
            >
              <span>{index < step ? <Check /> : index + 1}</span>
              {label}
            </button>
          ))}
        </div>
        <div className="upload-card">
          <SectionHeader
            title={steps[step]}
            description={`Step ${step + 1} of ${steps.length}`}
          />
          {Object.keys(errors).length > 0 && (
            <div className="form-error-summary" role="alert">
              <strong>Review the highlighted fields</strong>
              {Object.values(errors).map((error, index) => (
                <span key={index}>{error?.message}</span>
              ))}
            </div>
          )}
          {step === 0 && (
            <>
              <label className="dropzone">
                <UploadCloud />
                <strong>Drop files here or Browse files</strong>
                <span>TSV, CSV, H5, H5AD, Zarr, Parquet, VCF, BAM, FASTQ</span>
                <input
                  type="file"
                  multiple
                  hidden
                  onChange={(event) =>
                    setFiles(
                      Array.from(event.target.files ?? []).map(
                        (file) => file.name,
                      ),
                    )
                  }
                />
              </label>
              {files.map((file) => (
                <div className="settings-row" key={file}>
                  <File />
                  <span>
                    <strong>{file}</strong>
                    <small>Checksum queued · application/octet-stream</small>
                  </span>
                  <button
                    className="text-button"
                    onClick={() =>
                      setFiles((value) => value.filter((item) => item !== file))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </>
          )}
          {step === 1 && (
            <div className="form-grid">
              <Field label="Dataset name" error={errors.name?.message}>
                <input {...register("name")} />
              </Field>
              <Field label="Organism" error={errors.organism?.message}>
                <input {...register("organism")} />
              </Field>
              <Field
                label="Description"
                error={errors.description?.message}
                wide
              >
                <textarea {...register("description")} />
              </Field>
              <Field label="Modality" error={errors.modality?.message}>
                <input {...register("modality")} />
              </Field>
              <Field label="Assay" error={errors.assay?.message}>
                <input {...register("assay")} />
              </Field>
              <Field label="Reference genome" error={errors.reference?.message}>
                <input {...register("reference")} />
              </Field>
              <Field
                label="Annotation release"
                error={errors.annotation?.message}
              >
                <input {...register("annotation")} />
              </Field>
            </div>
          )}
          {step === 2 && (
            <div className="form-grid">
              <label>
                Role
                <select {...register("role")}>
                  <option>Primary matrix</option>
                  <option>Metadata</option>
                </select>
              </label>
              <label>
                Format
                <select {...register("format")}>
                  <option>H5AD</option>
                  <option>TSV</option>
                </select>
              </label>
              <label>
                Data class
                <select {...register("dataClass")}>
                  <option>canonical</option>
                  <option>raw</option>
                  <option>derived</option>
                </select>
              </label>
              <label>
                Compression
                <select {...register("compression")}>
                  <option>Automatic</option>
                  <option>gzip</option>
                </select>
              </label>
            </div>
          )}
          {step === 3 && (
            <div className="form-grid">
              <label>
                Visibility
                <select {...register("visibility")}>
                  <option>Private</option>
                  <option>Public</option>
                </select>
              </label>
              <label>
                Grant users
                <input
                  {...register("grantUsers")}
                  placeholder="Search users…"
                />
              </label>
              <label className="form-wide">
                Scopes
                <input {...register("scopes")} />
              </label>
            </div>
          )}
          {step === 4 && (
            <div className="review-list">
              <div>
                <File />
                <span>
                  <strong>{values.name}</strong>
                  <small>
                    {files.length} files · {values.visibility.toLowerCase()} ·
                    TileDB target
                  </small>
                </span>
              </div>
              <div>
                <Check />
                <span>
                  <strong>Expected transformations</strong>
                  <small>
                    Checksum, validation, canonicalization, materialization
                  </small>
                </span>
              </div>
              <div>
                <Check />
                <span>
                  <strong>Reference</strong>
                  <small>
                    {values.reference} · {values.annotation}
                  </small>
                </span>
              </div>
            </div>
          )}
          {step === 5 && (
            <div>
              <div className="upload-progress">
                <span style={{ width: `${progress}%` }} />
              </div>
              <p>
                Uploading multipart data · {progress}% · checksum verified for 2 of 3
                files
              </p>
              <div className="dialog-actions">
                <button className="outline-button" onClick={() => setProgress((value) => Math.min(100, value + 12))}>Retry failed part</button>
                <button className="danger-button" onClick={() => setCancelOpen(true)}>Cancel upload</button>
              </div>
            </div>
          )}
          <div className="upload-actions">
            <button
              className="outline-button"
              disabled={step === 0}
              onClick={() => setStep((value) => value - 1)}
            >
              Back
            </button>
            <button className="primary-button" onClick={() => step === 5 ? router.push("/console/jobs") : void next()}>
              {step === 5
                ? "Open ingestion job"
                : step === 0 && files.length === 0
                  ? "Use demo files"
                  : "Continue"}
            </button>
          </div>
        </div>
      </div>
      {cancelOpen && <div className="modal-scrim"><div className="simple-dialog" role="alertdialog" aria-modal="true"><h2>Cancel Upload</h2><p>Uploaded multipart parts will be discarded and this draft will be marked Cancelled.</p><div className="dialog-actions"><button className="outline-button" onClick={() => setCancelOpen(false)}>Keep uploading</button><button className="danger-button" onClick={() => router.push("/console/uploads")}>Cancel upload</button></div></div></div>}
    </AppShell>
  );
}

function Field({
  label,
  error,
  wide,
  children,
}: {
  label: string;
  error?: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={wide ? "form-wide" : ""}>
      {label}
      {children}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

"use client";

import { createElement, useState, useTransition } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  createSubcategory,
  deleteCategory,
  deleteSubcategory,
  reorderCategory,
  setCategoryArchived,
  setSubcategoryArchived,
  updateSubcategory,
} from "@/server/categories/actions";
import type { Category, Subcategory } from "@/server/categories/queries";
import { getIcon } from "@/lib/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDeleteButton } from "@/components/confirm-delete-button";
import { Input } from "@/components/ui/input";
import { CategoryDialog } from "./category-dialog";

function SubcategoryItem({ sub }: { sub: Subcategory }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sub.name);
  const [isPending, startTransition] = useTransition();
  const archived = !!sub.archivedAt;

  function save() {
    if (!name.trim() || name.trim() === sub.name) {
      setEditing(false);
      setName(sub.name);
      return;
    }
    startTransition(async () => {
      const result = await updateSubcategory({
        subcategoryId: sub.id,
        name: name.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setEditing(false);
      }
    });
  }

  function toggleArchive() {
    startTransition(async () => {
      const result = await setSubcategoryArchived(
        { subcategoryId: sub.id },
        !archived
      );
      if ("error" in result) toast.error(result.error);
    });
  }

  return (
    <li
      className={`flex items-center gap-2 py-1 ${archived ? "opacity-60" : ""}`}
    >
      {editing ? (
        <>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
              if (event.key === "Escape") {
                setEditing(false);
                setName(sub.name);
              }
            }}
            className="h-8"
            autoFocus
          />
          <Button size="sm" onClick={save} disabled={isPending}>
            {isPending ? <Loader2 className="animate-spin" /> : "Salvar"}
          </Button>
        </>
      ) : (
        <>
          <span className="flex-1 truncate text-sm">{sub.name}</span>
          {archived && <Badge variant="secondary">Arquivada</Badge>}
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => setEditing(true)}
            aria-label={`Renomear subcategoria ${sub.name}`}
          >
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={toggleArchive}
            disabled={isPending}
            aria-label={
              archived
                ? `Reativar subcategoria ${sub.name}`
                : `Arquivar subcategoria ${sub.name}`
            }
          >
            {archived ? (
              <ArchiveRestore className="size-3.5" />
            ) : (
              <Archive className="size-3.5" />
            )}
          </Button>
          <ConfirmDeleteButton
            className="size-7"
            ariaLabel={`Excluir subcategoria ${sub.name}`}
            title={`Excluir subcategoria “${sub.name}”?`}
            description="Exclusão definitiva. Só é possível se não houver lançamentos usando esta subcategoria — caso contrário, arquive."
            successMessage="Subcategoria excluída."
            onConfirm={() => deleteSubcategory({ subcategoryId: sub.id })}
          />
        </>
      )}
    </li>
  );
}

export function CategoryRow({
  category,
  canEdit,
}: {
  category: Category;
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [isPending, startTransition] = useTransition();

  const archived = !!category.archivedAt;
  const visibleSubs = category.subcategories;

  function addSubcategory() {
    if (!newName.trim()) return;
    startTransition(async () => {
      const result = await createSubcategory({
        categoryId: category.id,
        name: newName.trim(),
      });
      if ("error" in result) {
        toast.error(result.error);
      } else {
        setNewName("");
        setAdding(false);
        setExpanded(true);
      }
    });
  }

  function toggleArchive() {
    startTransition(async () => {
      const result = await setCategoryArchived(
        { categoryId: category.id },
        !archived
      );
      if ("error" in result) toast.error(result.error);
    });
  }

  function move(direction: "up" | "down") {
    startTransition(async () => {
      const result = await reorderCategory({
        categoryId: category.id,
        direction,
      });
      if ("error" in result) toast.error(result.error);
    });
  }

  return (
    <Card className={archived ? "opacity-70" : undefined}>
      <CardContent className="flex flex-col gap-2 py-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Recolher" : "Expandir"} categoria ${category.name}`}
            className="text-muted-foreground hover:text-foreground"
          >
            {expanded ? (
              <ChevronDown className="size-4" />
            ) : (
              <ChevronRight className="size-4" />
            )}
          </button>
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md"
            style={{
              backgroundColor: (category.color ?? "#64748b") + "22",
              color: category.color ?? "inherit",
            }}
          >
            {createElement(getIcon(category.icon), {
              className: "size-4",
              "aria-hidden": true,
            })}
          </span>
          <span className="flex-1 truncate font-medium">{category.name}</span>
          {archived && <Badge variant="secondary">Arquivada</Badge>}
          <span className="text-muted-foreground text-xs">
            {visibleSubs.filter((s) => !s.archivedAt).length} sub
          </span>
          {canEdit && (
            <div className="flex items-center">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => move("up")}
                disabled={isPending}
                aria-label={`Mover ${category.name} para cima`}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => move("down")}
                disabled={isPending}
                aria-label={`Mover ${category.name} para baixo`}
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <CategoryDialog kind={category.kind} category={category} />
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleArchive}
                disabled={isPending}
                aria-label={
                  archived
                    ? `Reativar categoria ${category.name}`
                    : `Arquivar categoria ${category.name}`
                }
              >
                {archived ? <ArchiveRestore /> : <Archive />}
              </Button>
              <ConfirmDeleteButton
                ariaLabel={`Excluir categoria ${category.name}`}
                title={`Excluir categoria “${category.name}”?`}
                description="Exclui a categoria e suas subcategorias definitivamente. Só é possível se não houver lançamentos vinculados — caso contrário, arquive."
                successMessage="Categoria excluída."
                onConfirm={() => deleteCategory({ categoryId: category.id })}
              />
            </div>
          )}
        </div>

        {expanded && (
          <div className="border-muted ml-5 border-l pl-5">
            {visibleSubs.length === 0 && !adding && (
              <p className="text-muted-foreground py-1 text-sm">
                Sem subcategorias.
              </p>
            )}
            <ul>
              {visibleSubs.map((sub) => (
                <SubcategoryItem key={sub.id} sub={sub} />
              ))}
            </ul>
            {canEdit &&
              (adding ? (
                <div className="flex items-center gap-2 py-1">
                  <Input
                    value={newName}
                    onChange={(event) => setNewName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSubcategory();
                      }
                      if (event.key === "Escape") setAdding(false);
                    }}
                    placeholder="Nome da subcategoria"
                    className="h-8"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={addSubcategory}
                    disabled={isPending}
                  >
                    {isPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      "Adicionar"
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => setAdding(false)}
                    aria-label="Cancelar"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => setAdding(true)}
                >
                  <Plus className="size-3.5" />
                  Subcategoria
                </Button>
              ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { Request, Response } from "express";
//import { Config } from "./config";
import { PARDProduct, KeyValue, NameMap, PAQMap } from "./models";
import { pagination } from "./pagination";
import { parseFmt, getRenderer, RenderTarget } from "./render";

const PAGE_SIZE: number = 10;

export module Controllers {
  export function index(_request: Request, response: Response) {
    getRenderer(RenderTarget.HTML, "home", response)({});
  }

  export function home(_request: Request, response: Response) {
    getRenderer(RenderTarget.HTML, "home", response)({});
  }

  export function wound(_request: Request, response: Response) {
    getRenderer(RenderTarget.HTML, "wound", response)({});
  }

  export function paq(_request: Request, response: Response) {
    getRenderer(RenderTarget.HTML, "paq", response)({});
  }

  export function paq2(_request: Request, response: Response) {
    getRenderer(RenderTarget.HTML, "paq2", response)({});
  }

  export function multiple(_request: Request, response: Response) {
    getRenderer(RenderTarget.HTML, "multiple", response)({});
  }

  export function multipleresults(_request: Request, response: Response) {
    getRenderer(RenderTarget.HTML, "multipleresults", response)({});
  }

  export function comparison(_request: Request, response: Response) {
    getRenderer(RenderTarget.HTML, "comparison", response)({});
  }

  export function search(request: Request, response: Response) {
    let format = parseFmt(request.query.format?.toString() || "html");
    let render = getRenderer(format, "search", response);

    let term: string = request.query.search?.toString() || "";
    let page = parseInt(request.query.page?.toString() || "1");
    let limit = PAGE_SIZE;
    let offset = (page - 1) * limit;

    let db = request.app.get("db");

    let rangeText = "";
    let total = 0;
    let products: PARDProduct[] = [];
    let sortBy = getSearchSort(request.query.sort?.toString() || "");

    if (term.trim().length == 0) {
      let [query, countQuery] = browseQuery();
      products = db.prepare(query).all(limit, offset);
      total = db.prepare(countQuery).get().total;
    } else {
      let qterm = quoteSearchTerm(term);
      console.log(qterm);

      let countQuery =
        "select count(PRODUCT_ID) as total from search where search match ?";
      total = db.prepare(countQuery).get(qterm).total;

      // Bump the limit for Excel and CSV to a large, but not unreasonable number for PoC.
      // Ideally we'd want to iterate/cursor our way through large number of results but that
      // would make the HTML rendering harder, so for prototypes we'll send a reasonably high limit
      if (format == RenderTarget.EXCEL || format == RenderTarget.CSV) {
        offset = 0;
        limit = 5000;
      }

      let query = `select rank, PRODUCT_ID from search where search match ? order by ${sortBy} LIMIT ? OFFSET ?;`;
      let idResults = db.prepare(query).all(qterm, limit, offset);

      if (idResults.length > 0) {
        let ids: number[] = idResults.map((d: any) => {
          return d.PRODUCT_ID;
        });
        query = getByIds(ids);

        products = db.prepare(query).all();
      }
    }

    if (products.length > 0) {
      rangeText = `${offset + 1} - ${offset + products.length}`;
    }

    let fullURL = `${request.protocol}://${request.get("host")}${request.originalUrl}`;

    let total_pages = Math.floor(total / PAGE_SIZE) + 1;
    let pages = pagination(fullURL, page, total_pages);

    let has_previous_page: string = "";
    let has_next_page: string = "";
    if (total_pages > 1) {
      if (page != 1) {
        let pageURL = new URL(fullURL);
        pageURL.searchParams.delete("page");
        pageURL.searchParams.set("page", (page - 1).toString());
        has_previous_page = pageURL.toString();
      }

      if (page != total_pages) {
        let pageURL = new URL(fullURL);
        pageURL.searchParams.delete("page");
        pageURL.searchParams.set("page", (page + 1).toString());
        has_next_page = pageURL.toString();
      }
    }

    let csv_url = "";
    let excel_url = "";

    if (total > 0) {
      let thisPage = new URL(fullURL);
      thisPage.searchParams.append("format", "excel");
      excel_url = thisPage.toString();

      thisPage.searchParams.set("format", "csv");
      csv_url = thisPage.toString();
    }

    render({
      term: request.query["search"] || "",
      back: request.get("Referrer"),
      total: total,
      page: offset,
      rangeText: rangeText,
      products: products,
      has_previous_page: has_previous_page,
      has_next_page: has_next_page,
      pages: pages,
      csv_download: csv_url,
      excel_download: excel_url,
      sort: getSortOptions(fullURL),
    });
  }

  function getSortOptions(url: string): any {
    let sort_options = {
      relevant: "",
      manufacturer_az: "",
      manufacturer_za: "",
      name_az: "",
      name_za: "",
    };

    let sortURL = new URL(url);
    sortURL.searchParams.delete("page");
    sortURL.searchParams.delete("sort");
    sort_options.relevant = sortURL.toString();

    sortURL.searchParams.set("sort", "manufacturer");
    sort_options.manufacturer_az = sortURL.toString();

    sortURL.searchParams.set("sort", "-manufacturer");
    sort_options.manufacturer_za = sortURL.toString();

    sortURL.searchParams.set("sort", "name");
    sort_options.name_az = sortURL.toString();

    sortURL.searchParams.set("sort", "-name");
    sort_options.name_za = sortURL.toString();

    return sort_options;
  }

  function browseQuery(): [string, string] {
    return [
      `SELECT P.*, D.* FROM products AS P INNER JOIN devices as D ON D.DEVICE_ID=P.DEVICE_ID
     LIMIT ? OFFSET ?`,
      `SELECT COUNT(*) as total FROM products`,
    ];
  }

  function getByIds(ids: number[]): string {
    var inExpression = ids.join(",");

    return `SELECT P.*,D.* FROM products as P INNER JOIN devices as D ON D.DEVICE_ID=P.DEVICE_ID WHERE PRODUCT_ID IN (${inExpression})`;
  }

  export function detail(request: Request, response: Response) {
    let format = parseFmt(request.query.format?.toString() || "html");
    let render = getRenderer(format, "detail", response);

    let query = `SELECT P.*, D.* FROM products AS P INNER JOIN devices as D ON D.DEVICE_ID=P.DEVICE_ID WHERE PRODUCT_ID = ?`;

    let db = request.app.get("db");
    let product = db.prepare(query).get(request.params.id);

    let manufacturer = db
      .prepare(`select * from organisations where MAN_ORGANISATION_ID=?`)
      .get(product.MANUFACTURER_ID);

    // Cleanup product
    product.UNIT_OF_USE_UDI_DI = clean_boolean(product.UNIT_OF_USE_UDI_DI);
    product.SINGLE_USE_DEVICE = clean_boolean(product.SINGLE_USE_DEVICE);
    product.IS_STERILE = clean_boolean(product.IS_STERILE);
    product.DEVICE_IMPLANTABLE = clean_boolean(product.DEVICE_IMPLANTABLE);
    product.IS_CONTAINING_LATEX = clean_boolean(product.IS_CONTAINING_LATEX);

    // Fudge to make the product code available in the manufacturer template
    if (manufacturer) {
      manufacturer.PRODUCT_CODE = product.PRODUCT_CODE;
    }

    let debug = request.query.debug || "";
    if (debug) {
      debug = product;
    }

    let fullURL = `${request.protocol}://${request.get("host")}${request.originalUrl}`;
    let thisPage = new URL(fullURL);
    thisPage.searchParams.append("format", "excel");
    let excel_url = thisPage.toString();

    thisPage.searchParams.set("format", "csv");
    let csv_url = thisPage.toString();

    var obj: { [k: string]: any } = {
      id: request.params.id,
      back: request.get("Referrer"),
      manufacturer: manufacturer,
      debug: debug,
      excel_download: excel_url,
      csv_download: csv_url,
      term: product.PRODUCT_ID.toString(), // for the filename where used
    };

    // FUDGE to show a single row when an array is necessary
    if (format != RenderTarget.HTML) {
      obj.products = [product];
    } else {
      obj.product = product;
    }
    render(obj);
  }

  export function flag(request: Request, response: Response) {
    let render = getRenderer(RenderTarget.HTML, "flag", response);

    let fields = getAllFields(
      request,
      request.params.id,
      (k: string, v: any) => {
        return v && !k.endsWith("_ID") && v != "NULL";
      },
      (_k: string, v: any) => {
        return v as boolean;
      },
    );

    render({
      ID: request.params.id,
      FIELDS: fields,
    });
  }

  export function flagsubmitted(request: Request, response: Response) {
    let render = getRenderer(RenderTarget.HTML, "flagsubmitted", response);
    render({ ID: request.params.id });
  }

  export function flagconfirmation(request: Request, response: Response) {
    let render = getRenderer(RenderTarget.HTML, "flagconfirmation", response);
    render({ ID: request.params.id });
  }

  export function requestsubmitted(request: Request, response: Response) {
    let render = getRenderer(RenderTarget.HTML, "requestsubmitted", response);
    render({ ID: request.params.id });
  }

  export function requestconfirmation(request: Request, response: Response) {
    let render = getRenderer(
      RenderTarget.HTML,
      "requestconfirmation",
      response,
    );
    render({ ID: request.params.id });
  }

  export function request(request: Request, response: Response) {
    let render = getRenderer(RenderTarget.HTML, "request", response);

    let fields = getAllFields(
      request,
      request.params.id,
      (k: string, v: any) => {
        return (!v || v == "NULL") && !k.endsWith("_ID");
      },
      (_k: string, v: any) => {
        return !(v as boolean);
      },
    );

    PAQMap.forEach((title: string, key: string) => {
      fields.push({
        key,
        title,
        value: "",
      });
    });

    render({
      ID: request.params.id,
      FIELDS: fields,
    });
  }
}

function getAllFields(
  request: Request,
  id: string,
  prod_fnc: (k: string, v: any) => boolean,
  manuf_fnc: (k: string, v: any) => boolean,
): KeyValue[] {
  let query = `SELECT P.*, D.* FROM products AS P INNER JOIN devices as D ON D.DEVICE_ID=P.DEVICE_ID WHERE PRODUCT_ID = ?`;
  let db = request.app.get("db");
  let product = db.prepare(query).get(id);
  let manufacturer = db
    .prepare(`select * from organisations where MAN_ORGANISATION_ID=?`)
    .get(product.MANUFACTURER_ID);

  let fields: KeyValue[] = [];

  for (const [key, value] of Object.entries(product)) {
    let title: string = NameMap.get(key) || "";
    if (title == "") continue;

    if (prod_fnc(key, value)) {
      fields.push({ key, title, value: remove_null(value) });
    }
  }

  if (manufacturer) {
    for (const [key, value] of Object.entries(manufacturer)) {
      let title: string = NameMap.get(key) || "";
      if (title == "") continue;

      if (manuf_fnc(key, value)) {
        fields.push({ key, title, value: remove_null(value) });
      }
    }
  }

  return fields;
}

function remove_null(s: any): string {
  if (s == "NULL") return "";
  return s.toString();
}

function clean_boolean(val?: string | undefined): string {
  if (val === null || val === undefined || val == "" || val == "NULL") {
    return "";
  }

  if (val === "0") {
    return "No";
  } else if (val === "1") {
    return "Yes";
  } else if (val.toLowerCase() === "na") {
    return "Not applicable";
  }

  return val;
}

function quoteSearchTerm(text: string): string {
  let parts = text.split(/[\s,]+/);
  return parts
    .map((s: string): string => {
      if (!!s.match(/[@#$%^&.,:?-_]/)) return '"' + s + '"';
      return s;
    })
    .join(" ");
}

const sortLookup = new Map<string, string>([
  ["manufacturer", "lower(trim(MANUFACTURER))"],
  ["name", "lower(trim(PRODUCT))"],
  ["term", "lower(trim(GMDN))"],
]);

const defaultSort = "rank";

function getSearchSort(sortTerm: string): string {
  let key = sortTerm;
  if (sortTerm == "") return defaultSort;

  let direction = "";
  if (key.charAt(0) == "-") {
    direction = "DESC";
    key = key.slice(1);
  }

  let ordering = sortLookup.get(key) || defaultSort;
  return `${ordering} ${direction}`;
}

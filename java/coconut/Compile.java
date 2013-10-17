package coconut;

import java.io.*;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import javax.tools.*;
import javax.tools.JavaCompiler.CompilationTask;
import javax.tools.JavaFileObject.Kind;

import org.json.JSONObject;

public class Compile {
    
    final boolean success;
    final String output;
    final List<Diagnostic<? extends JavaFileObject>> errors;
    final List<JavaClassBytes> classes;
    
    Compile(List<JavaSourceString> sources) {
        JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
        
        InMemoryFileManager fileManager = new InMemoryFileManager();
        
        StringWriter compilation = new StringWriter();
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<JavaFileObject>();
        CompilationTask task = compiler.getTask(compilation, fileManager, diagnostics, null, null, sources);
        this.success = task.call();
        this.output = compilation.toString();
        this.errors = diagnostics.getDiagnostics();
        this.classes = fileManager.outputs;
    }
    
    private static List<JSONObject> json(List<Diagnostic<? extends JavaFileObject>> diagnostics) {
        List<JSONObject> objects = new ArrayList<JSONObject>();
        for (Diagnostic<? extends JavaFileObject> diagnostic : diagnostics) {
            JSONObject obj = new JSONObject();
            obj.put("lineNumber", diagnostic.getLineNumber());
            obj.put("columnNumber", diagnostic.getColumnNumber());
            obj.put("startPosition", diagnostic.getStartPosition());
            obj.put("position", diagnostic.getPosition());
            obj.put("endPosition", diagnostic.getEndPosition());
            obj.put("kind", diagnostic.getKind());
            obj.put("message", diagnostic.getMessage(null));
            obj.put("source", diagnostic.getSource().getName());
            objects.add(obj);
        }
        return objects;
    }
    
    public static void main(String[] args) throws IOException {
        JSONObject in = new JSONObject(args[0]);
        List<JavaSourceString> sources = new ArrayList<JavaSourceString>();
        for (Object key : in.keySet()) {
            String name = (String)key;
            sources.add(new JavaSourceString(name, in.getString(name)));
        }
        
        Compile compile = new Compile(sources);
        
        if (compile.success && ! compile.classes.isEmpty()) {
            ZipOutputStream zip = new ZipOutputStream(System.out);
            for (JavaClassBytes bytes : compile.classes) {
                zip.putNextEntry(new ZipEntry(bytes.getName()));
                zip.write(bytes.bytes());
                zip.closeEntry();
            }
            zip.close();
        }
        JSONObject err = new JSONObject();
        err.put("output", compile.output);
        err.put("errors", json(compile.errors));
        System.err.println(err);
    }
}

class InMemoryFileManager extends ForwardingJavaFileManager<JavaFileManager> {
    
    public final List<JavaClassBytes> outputs = new ArrayList<JavaClassBytes>();
    
    InMemoryFileManager() {
        super(ToolProvider.getSystemJavaCompiler().getStandardFileManager(null, null, null));
    }
    
    @Override public FileObject getFileForInput(Location location, String packageName, String relativeName) throws IOException {
        throw new IOException("Unsupported getFileForInput");
    }
    
    @Override public FileObject getFileForOutput(Location location, String packageName, String relativeName, FileObject sibling) throws IOException {
        throw new IOException("Unsupported getFileForOutput");
    }
    
    @Override public JavaFileObject getJavaFileForInput(Location location, String className, Kind kind) throws IOException {
        throw new IOException("Unsupported getJavaFileForInput");
    }
    
    @Override public JavaFileObject getJavaFileForOutput(Location location, String className, Kind kind, FileObject sibling) throws IOException {
        if (location != StandardLocation.CLASS_OUTPUT) { throw new IOException("Output location must be CLASS_OUTPUT"); }
        if (kind != Kind.CLASS) { throw new IOException("Output kind must be CLASS"); }
        
        JavaClassBytes file = new JavaClassBytes(className);
        outputs.add(file);
        return file;
    }
}

class JavaSourceString extends SimpleJavaFileObject {
    
    private final String fileName;
    private final String code;
    
    JavaSourceString(String className, String code) {
        this(className, className.replace('.', '/') + Kind.SOURCE.extension, code);
    }
    
    private JavaSourceString(String className, String fileName, String code) {
        super(URI.create("string:///" + fileName), Kind.SOURCE);
        this.fileName = fileName;
        this.code = code;
    }
    
    @Override public String getName() {
        return fileName;
    }
    
    @Override public CharSequence getCharContent(boolean ignoreEncodingErrors) {
        return code;
    }
}

class JavaClassBytes extends SimpleJavaFileObject {
    
    private final String fileName;
    private final ByteArrayOutputStream bytes;
    
    JavaClassBytes(String className) {
        this(className, className.replace('.', '/') + Kind.CLASS.extension);
    }
    
    private JavaClassBytes(String className, String fileName) {
        super(URI.create("bytes:///" + fileName), Kind.CLASS);
        this.fileName = fileName;
        this.bytes = new ByteArrayOutputStream();
    }
    
    byte[] bytes() {
        return bytes.toByteArray();
    }
    
    @Override public String getName() {
        return fileName;
    }
    
    @Override public OutputStream openOutputStream() {
        return bytes;
    }
}

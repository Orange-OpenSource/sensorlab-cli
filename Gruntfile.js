module.exports = function (grunt) {
    grunt.initConfig({
        pkg: grunt.file.readJSON('package.json'),

        eslint: {
            target: ['<%= pkg.name %>.js']
        },
        jsdoc: {
            dist: {
                src: '<%= pkg.name %>.js',
                options: {
                    destination: 'doc'
                }
            }
        },
    });

    grunt.loadNpmTasks('grunt-eslint');
    grunt.loadNpmTasks('grunt-jsdoc');


    grunt.registerTask('test', ['eslint']);
    grunt.registerTask('doc', ['jsdoc']);
    grunt.registerTask('default', ['eslint']);
};
